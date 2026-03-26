import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Octokit } from "octokit";
import dotenv from "dotenv";

dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/github/:username", async (req, res) => {
    const { username } = req.params;
    try {
      // Fetch user profile
      const { data: profile } = await octokit.rest.users.getByUsername({
        username,
      });

      // Fetch user repos
      const { data: repos } = await octokit.rest.repos.listForUser({
        username,
        per_page: 100,
        sort: "updated",
      });

      // Calculate stats
      const stats = {
        totalRepos: profile.public_repos,
        followers: profile.followers,
        following: profile.following,
        totalStars: repos.reduce((acc, repo) => acc + (repo.stargazers_count || 0), 0),
        totalForks: repos.reduce((acc, repo) => acc + (repo.forks_count || 0), 0),
        languages: repos.reduce((acc: Record<string, number>, repo) => {
          if (repo.language) {
            acc[repo.language] = (acc[repo.language] || 0) + 1;
          }
          return acc;
        }, {}),
        recentRepos: repos.slice(0, 5).map(repo => ({
          name: repo.name,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          language: repo.language,
          description: repo.description,
          url: repo.html_url
        }))
      };

      res.json({ profile, stats });
    } catch (error: any) {
      console.error("GitHub API Error:", error);
      res.status(error.status || 500).json({ 
        error: error.message || "Failed to fetch GitHub data",
        rateLimit: error.status === 403
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
