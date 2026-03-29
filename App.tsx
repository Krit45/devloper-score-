import React, { useState, useEffect } from "react";
import { Search, Github, Star, GitFork, Book, User, TrendingUp, AlertCircle, Loader2, BarChart3, MessageSquare, History } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from "recharts";
import { db, auth } from "./firebase";
import { collection, addDoc, query, where, getDocs, orderBy, onSnapshot, Timestamp } from "firebase/firestore";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import ReactMarkdown from "react-markdown";
import { cn } from "./lib/utils";

// --- Types ---
interface GitHubProfile {
  login: string;
  avatar_url: string;
  name: string;
  bio: string;
  public_repos: number;
  followers: number;
  following: number;
  html_url: string;
}

interface RepoStats {
  name: string;
  stars: number;
  forks: number;
  language: string;
  description: string;
  url: string;
}

interface AnalysisStats {
  totalRepos: number;
  followers: number;
  following: number;
  totalStars: number;
  totalForks: number;
  languages: Record<string, number>;
  recentRepos: RepoStats[];
}

interface AnalysisResult {
  profile: GitHubProfile;
  stats: AnalysisStats;
  score: number;
}

// --- Constants ---
const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d"];

// --- Components ---

const StatCard = ({ icon: Icon, label, value, color }: { icon: any, label: string, value: string | number, color: string }) => (
  <motion.div 
    whileHover={{ y: -4, scale: 1.02 }}
    className="bg-white/80 backdrop-blur-md p-6 rounded-3xl shadow-sm border border-white/20 flex items-center gap-4 group transition-all hover:shadow-xl hover:shadow-indigo-500/10"
  >
    <div className={cn("p-4 rounded-2xl transition-transform group-hover:scale-110", color)}>
      <Icon className="w-6 h-6 text-white" />
    </div>
    <div>
      <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-2xl font-black text-gray-900">{value}</p>
    </div>
  </motion.div>
);

export default function App() {
  const [username, setUsername] = useState("");
  const [username2, setUsername2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [result2, setResult2] = useState<AnalysisResult | null>(null);
  const [suggestions, setSuggestions] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [comparisonInsights, setComparisonInsights] = useState<string | null>(null);
  
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      const q = query(
        collection(db, "reports"),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (err) => {
        console.error("Firestore Error:", err);
      });
      return () => unsubscribe();
    }
  }, [user]);

  const saveReport = async () => {
    if (!user || !result) return;
    try {
      await addDoc(collection(db, "reports"), {
        userId: user.uid,
        username: result.profile.login,
        score: result.score,
        stats: result.stats,
        profile: result.profile,
        createdAt: Timestamp.now(),
      });
      alert("Report saved successfully!");
    } catch (err) {
      console.error("Save Error:", err);
      alert("Failed to save report.");
    }
  };

  const login = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      console.error("Login Error:", err);
    }
  };

  const handleAnalyze = async () => {
    if (!username) return;
    
    if (isCompareMode) {
      if (!username2) {
        setError("Please enter a second username to compare.");
        return;
      }
      // Fetch both
      await fetchAnalysis(username);
      await fetchAnalysis(username2, true);
    } else {
      await fetchAnalysis(username);
    }
  };

  const fetchAnalysis = async (user: string, isSecond = false) => {
    if (isSecond) {
      setLoading(true);
    } else {
      setLoading(true);
      if (!isCompareMode) {
        setResult(null);
        setResult2(null);
        setComparisonInsights(null);
      }
    }
    setError(null);
    setSuggestions(null);

    try {
      const response = await fetch(`/api/github/${user}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch GitHub data");
      }

      const calculatedScore = calculateScore(data.stats);
      const resultWithScore = { ...data, score: calculatedScore };

      if (isSecond) {
        setResult2(resultWithScore);
        // If we have both results, generate comparison insights
        if (result) {
          generateComparisonInsights(result, resultWithScore);
        }
      } else {
        setResult(resultWithScore);
        if (!isCompareMode) {
          generateAISuggestions(resultWithScore);
        } else if (username2) {
          // If already in compare mode and have second username, fetch it
          fetchAnalysis(username2, true);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const calculateScore = (stats: AnalysisStats) => {
    // Basic scoring logic
    let s = 0;
    s += Math.min(stats.totalRepos * 2, 20); // Max 20 for repos
    s += Math.min(stats.totalStars * 5, 30); // Max 30 for stars
    s += Math.min(stats.followers * 2, 20); // Max 20 for followers
    s += Math.min(Object.keys(stats.languages).length * 5, 20); // Max 20 for language diversity
    s += Math.min(stats.totalForks * 3, 10); // Max 10 for forks
    
    return Math.min(s, 100);
  };

  const generateComparisonInsights = async (user1: AnalysisResult, user2: AnalysisResult) => {
    setAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const prompt = `
        Compare these two GitHub developers and provide a side-by-side analysis.
        
        Developer 1: ${user1.profile.name || user1.profile.login}
        - Bio: ${user1.profile.bio}
        - Repos: ${user1.stats.totalRepos}, Stars: ${user1.stats.totalStars}
        - Languages: ${Object.keys(user1.stats.languages).join(", ")}
        
        Developer 2: ${user2.profile.name || user2.profile.login}
        - Bio: ${user2.profile.bio}
        - Repos: ${user2.stats.totalRepos}, Stars: ${user2.stats.totalStars}
        - Languages: ${Object.keys(user2.stats.languages).join(", ")}
        
        Provide:
        1. A brief summary of their relative strengths.
        2. Who seems more specialized vs. generalized.
        3. A "verdict" on who has a more impactful portfolio based on these metrics.
        
        Format the response in Markdown.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      setComparisonInsights(response.text || "No comparison insights generated.");
    } catch (err) {
      console.error("AI Error:", err);
      setComparisonInsights("Failed to generate comparison insights.");
    } finally {
      setAnalyzing(false);
    }
  };

  const generateAISuggestions = async (data: AnalysisResult) => {
    setAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const prompt = `
        Analyze this GitHub developer profile and provide 3-5 specific, actionable suggestions to improve their portfolio.
        
        Profile: ${data.profile.name || data.profile.login}
        Bio: ${data.profile.bio}
        Repos: ${data.stats.totalRepos}
        Stars: ${data.stats.totalStars}
        Languages: ${Object.keys(data.stats.languages).join(", ")}
        Recent Repos: ${data.stats.recentRepos.map(r => r.name).join(", ")}
        
        Format the response in Markdown. Focus on:
        1. Repo organization
        2. Language diversity or focus
        3. Documentation (READMEs)
        4. Contribution frequency
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      setSuggestions(response.text || "No suggestions generated.");
    } catch (err) {
      console.error("AI Error:", err);
      setSuggestions("Failed to generate AI suggestions. Please check your API key.");
    } finally {
      setAnalyzing(false);
    }
  };

  const languageData = result ? Object.entries(result.stats.languages).map(([name, value]) => ({ name, value })) : [];

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-xl border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 md:h-20 flex items-center justify-between">
          <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setResult(null)}>
            <div className="bg-indigo-600 p-2 rounded-xl group-hover:rotate-12 transition-transform">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl md:text-2xl font-black tracking-tighter text-gray-900">DevScore</h1>
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            <button 
              onClick={() => {
                setIsCompareMode(!isCompareMode);
                setResult(null);
                setResult2(null);
                setComparisonInsights(null);
              }}
              className={cn(
                "p-2 md:px-4 md:py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
                isCompareMode ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "text-gray-500 hover:bg-gray-100"
              )}
            >
              <GitFork className="w-4 h-4" />
              <span className="hidden md:inline">Compare</span>
            </button>
            {user ? (
              <button 
                onClick={() => setShowHistory(!showHistory)}
                className={cn(
                  "p-2 md:px-4 md:py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
                  showHistory ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "text-gray-500 hover:bg-gray-100"
                )}
              >
                <History className="w-4 h-4" />
                <span className="hidden md:inline">History</span>
              </button>
            ) : (
              <button 
                onClick={login}
                className="p-2 md:px-4 md:py-2 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 flex items-center gap-2"
              >
                <User className="w-4 h-4" />
                <span className="hidden md:inline">Login</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-12 flex flex-col md:flex-row gap-8">
        {/* History Sidebar/Drawer */}
        <AnimatePresence>
          {showHistory && user && (
            <motion.aside 
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              className="fixed inset-y-0 left-0 z-50 w-80 bg-white/95 backdrop-blur-2xl p-8 shadow-2xl border-r border-white/20 md:relative md:inset-auto md:z-0 md:w-72 md:shrink-0 md:bg-white/50 md:rounded-3xl md:h-fit md:sticky md:top-28"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="font-black text-xl flex items-center gap-2">
                  <History className="w-5 h-5 text-indigo-600" />
                  Saved Reports
                </h3>
                <button onClick={() => setShowHistory(false)} className="md:hidden p-2 hover:bg-gray-100 rounded-xl">
                  <AlertCircle className="w-5 h-5 rotate-45" />
                </button>
              </div>
              <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)] pr-2">
                {history.length === 0 ? (
                  <div className="text-center py-12">
                    <History className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                    <p className="text-sm text-gray-400 font-medium">No saved reports yet.</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <motion.button
                      whileHover={{ x: 4 }}
                      key={item.id}
                      onClick={() => {
                        setResult({ profile: item.profile, stats: item.stats, score: item.score });
                        setShowHistory(false);
                      }}
                      className="w-full text-left p-4 rounded-2xl hover:bg-indigo-50 transition-all group border border-transparent hover:border-indigo-100"
                    >
                      <p className="font-black text-gray-900 group-hover:text-indigo-600 transition-colors">{item.username}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] font-bold text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded-full">Score: {item.score}</span>
                        <span className="text-[10px] text-gray-400 font-medium">{new Date(item.createdAt.seconds * 1000).toLocaleDateString()}</span>
                      </div>
                    </motion.button>
                  ))
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
        
        <div className="flex-1">
          {!result && !loading && !error && (
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex flex-col items-center justify-center py-12 md:py-20 text-center"
          >
            <div className="bg-white/80 backdrop-blur-2xl p-8 md:p-12 rounded-[2.5rem] shadow-2xl shadow-indigo-500/10 max-w-2xl border border-white/20">
              <div className="bg-indigo-50 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-8 animate-bounce-slow">
                <Github className="w-10 h-10 text-indigo-600" />
              </div>
              <h2 className="text-4xl md:text-5xl font-black mb-6 tracking-tight text-gray-900">
                Unlock Your <span className="text-indigo-600">Dev Potential</span>
              </h2>
              <p className="text-gray-500 mb-10 text-lg leading-relaxed font-medium">
                Deep analysis of repository quality, language diversity, and AI-powered improvement suggestions.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Enter GitHub username..."
                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-bold"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                  />
                </div>
                {isCompareMode && (
                  <div className="flex-1 relative">
                    <GitFork className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Compare with..."
                      className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-bold"
                      value={username2}
                      onChange={(e) => setUsername2(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                    />
                  </div>
                )}
                <button 
                  onClick={handleAnalyze}
                  disabled={loading || !username}
                  className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 disabled:opacity-50 active:scale-95"
                >
                  Analyze
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
            <p className="text-gray-500 font-medium animate-pulse">Fetching GitHub data...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 p-6 rounded-2xl flex items-start gap-4 max-w-2xl mx-auto">
            <AlertCircle className="w-6 h-6 text-red-600 shrink-0" />
            <div>
              <h3 className="text-red-900 font-bold mb-1">Analysis Failed</h3>
              <p className="text-red-700 text-sm">{error}</p>
              <button 
                onClick={() => fetchAnalysis(username)}
                className="mt-4 text-red-600 font-semibold text-sm hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {result && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-8 animate-in fade-in duration-700"
          >
            {isCompareMode && result2 ? (
              <div className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Comparison View */}
                  {[result, result2].map((r, idx) => (
                    <motion.div 
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: idx * 0.2 }}
                      key={idx} 
                      className="space-y-6"
                    >
                      <div className="bg-white/80 backdrop-blur-md p-8 rounded-[2.5rem] shadow-sm border border-white/20 flex flex-col items-center text-center gap-4">
                        <div className="relative">
                          <img src={r.profile.avatar_url} alt={r.profile.login} className="w-24 h-24 rounded-3xl shadow-xl ring-4 ring-white" />
                          <div className="absolute -bottom-2 -right-2 bg-indigo-600 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg">
                            Score: {r.score}
                          </div>
                        </div>
                        <div>
                          <h3 className="font-black text-2xl text-gray-900">{r.profile.name || r.profile.login}</h3>
                          <p className="text-sm text-gray-400 font-medium line-clamp-2 mt-2">{r.profile.bio}</p>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <a href={r.profile.html_url} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-gray-900 text-white text-xs font-black rounded-xl">Profile</a>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <StatCard icon={Book} label="Repos" value={r.stats.totalRepos} color="bg-blue-500" />
                        <StatCard icon={Star} label="Stars" value={r.stats.totalStars} color="bg-amber-500" />
                        <StatCard icon={GitFork} label="Forks" value={r.stats.totalForks} color="bg-emerald-500" />
                        <StatCard icon={User} label="Followers" value={r.stats.followers} color="bg-purple-500" />
                      </div>

                      <div className="bg-white/80 backdrop-blur-md p-8 rounded-[2.5rem] shadow-sm border border-white/20">
                        <h4 className="font-black text-xl text-gray-900 mb-8 flex items-center gap-3">
                          <BarChart3 className="w-5 h-5 text-indigo-600" />
                          Language Mix
                        </h4>
                        <div className="h-[250px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={Object.entries(r.stats.languages).map(([name, value]) => ({ name, value }))}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                              >
                                {Object.entries(r.stats.languages).map((_, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* AI Comparison Insights */}
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="bg-indigo-600 p-8 md:p-12 rounded-[3rem] shadow-2xl shadow-indigo-200 text-white"
                >
                  <h3 className="text-3xl font-black mb-8 flex items-center gap-4">
                    <MessageSquare className="w-8 h-8" />
                    AI Comparison Insights
                  </h3>
                  {analyzing ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-4">
                      <Loader2 className="w-10 h-10 animate-spin" />
                      <p className="font-bold animate-pulse uppercase tracking-widest text-indigo-100">Generating Comparison...</p>
                    </div>
                  ) : (
                    <div className="prose prose-invert max-w-none prose-p:text-indigo-50 prose-headings:text-white prose-headings:font-black">
                      <ReactMarkdown>{comparisonInsights || ""}</ReactMarkdown>
                    </div>
                  )}
                </motion.div>
              </div>
            ) : (
              <>
                {/* Profile Header */}
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="bg-white/80 backdrop-blur-md p-8 rounded-[2.5rem] shadow-sm border border-white/20 flex flex-col md:flex-row items-center gap-8 relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full -mr-32 -mt-32 blur-3xl" />
                  <img 
                    src={result.profile.avatar_url} 
                    alt={result.profile.login} 
                    className="w-32 h-32 md:w-40 md:h-40 rounded-[2.5rem] shadow-2xl ring-8 ring-white/50 relative z-10"
                  />
                  <div className="flex-1 text-center md:text-left relative z-10">
                    <h2 className="text-4xl md:text-5xl font-black text-gray-900 mb-4 tracking-tight">{result.profile.name || result.profile.login}</h2>
                    <p className="text-gray-500 mb-6 max-w-2xl text-lg font-medium leading-relaxed">{result.profile.bio || "No bio available"}</p>
                    <div className="flex flex-wrap justify-center md:justify-start gap-4">
                      <motion.a 
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        href={result.profile.html_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-2xl text-sm font-black shadow-xl shadow-gray-200 transition-all"
                      >
                        <Github className="w-4 h-4" />
                        GitHub Profile
                      </motion.a>
                    </div>
                  </div>
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.3, type: "spring" }}
                    className="bg-indigo-600 p-8 rounded-[2.5rem] text-center min-w-[180px] shadow-2xl shadow-indigo-200 relative z-10"
                  >
                    <p className="text-xs text-indigo-100 font-black uppercase tracking-[0.2em] mb-2">Dev Score</p>
                    <p className="text-6xl font-black text-white tracking-tighter">{result.score}</p>
                    <div className="w-full bg-indigo-500/30 h-1.5 rounded-full mt-6 overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${result.score}%` }}
                        transition={{ duration: 1, delay: 0.5 }}
                        className="bg-white h-full"
                      />
                    </div>
                    {user && (
                      <button 
                        onClick={saveReport}
                        className="mt-6 w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-2xl text-xs font-black transition-all border border-white/20 backdrop-blur-sm"
                      >
                        Save Report
                      </button>
                    )}
                  </motion.div>
                </motion.div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                  <StatCard icon={Book} label="Repos" value={result.stats.totalRepos} color="bg-blue-500" />
                  <StatCard icon={Star} label="Stars" value={result.stats.totalStars} color="bg-amber-500" />
                  <StatCard icon={GitFork} label="Forks" value={result.stats.totalForks} color="bg-emerald-500" />
                  <StatCard icon={User} label="Followers" value={result.stats.followers} color="bg-purple-500" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Language Chart */}
                  <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="lg:col-span-2 bg-white/80 backdrop-blur-md p-8 rounded-[2.5rem] shadow-sm border border-white/20"
                  >
                    <div className="flex items-center justify-between mb-10">
                      <h3 className="text-2xl font-black flex items-center gap-3">
                        <BarChart3 className="w-6 h-6 text-indigo-600" />
                        Language Distribution
                      </h3>
                    </div>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={languageData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af', fontWeight: 700 }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af', fontWeight: 700 }} />
                          <Tooltip 
                            contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '16px' }}
                            cursor={{ fill: '#f3f4f6', radius: 8 }}
                          />
                          <Bar dataKey="value" fill="#4f46e5" radius={[8, 8, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </motion.div>

                  {/* Language Pie */}
                  <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white/80 backdrop-blur-md p-8 rounded-[2.5rem] shadow-sm border border-white/20"
                  >
                    <h3 className="text-2xl font-black mb-10">Diversity</h3>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={languageData}
                            cx="50%"
                            cy="50%"
                            innerRadius={70}
                            outerRadius={100}
                            paddingAngle={8}
                            dataKey="value"
                          >
                            {languageData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                          />
                          <Legend verticalAlign="bottom" height={36} iconType="circle" />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </motion.div>
                </div>

                {/* AI Suggestions & Recent Repos */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* AI Suggestions */}
                  <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="bg-white/80 backdrop-blur-md p-8 rounded-[2.5rem] shadow-sm border border-white/20"
                  >
                    <h3 className="text-2xl font-black mb-8 flex items-center gap-3">
                      <MessageSquare className="w-6 h-6 text-indigo-600" />
                      AI Insights
                    </h3>
                    {analyzing ? (
                      <div className="flex flex-col items-center justify-center py-20 space-y-6">
                        <div className="relative">
                          <div className="w-12 h-12 border-4 border-indigo-100 rounded-full animate-spin border-t-indigo-600" />
                        </div>
                        <p className="text-gray-400 text-sm font-bold animate-pulse uppercase tracking-widest">Analyzing Codebase...</p>
                      </div>
                    ) : (
                      <div className="prose prose-indigo max-w-none prose-p:text-gray-600 prose-headings:text-gray-900 prose-headings:font-black">
                        <ReactMarkdown>{suggestions || ""}</ReactMarkdown>
                      </div>
                    )}
                  </motion.div>

                  {/* Recent Repositories */}
                  <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="bg-white/80 backdrop-blur-md p-8 rounded-[2.5rem] shadow-sm border border-white/20"
                  >
                    <h3 className="text-2xl font-black mb-8 flex items-center gap-3">
                      <History className="w-6 h-6 text-indigo-600" />
                      Recent Projects
                    </h3>
                    <div className="space-y-4">
                      {result.stats.recentRepos.map((repo, i) => (
                        <motion.a 
                          whileHover={{ x: 4 }}
                          key={i}
                          href={repo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-6 rounded-3xl border border-white/50 bg-white/30 hover:bg-white/80 hover:shadow-xl hover:shadow-indigo-500/5 transition-all group"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-black text-lg text-gray-900 group-hover:text-indigo-600 transition-colors">{repo.name}</h4>
                            <div className="flex items-center gap-4 text-xs font-bold text-gray-400">
                              <span className="flex items-center gap-1.5"><Star className="w-3.5 h-3.5 text-amber-400" /> {repo.stars}</span>
                              <span className="flex items-center gap-1.5"><GitFork className="w-3.5 h-3.5 text-indigo-400" /> {repo.forks}</span>
                            </div>
                          </div>
                          <p className="text-sm text-gray-500 font-medium line-clamp-2 mb-4 leading-relaxed">{repo.description || "No description provided."}</p>
                          {repo.language && (
                            <span className="inline-block px-3 py-1 bg-indigo-50 text-indigo-600 text-[10px] font-black rounded-full uppercase tracking-widest">
                              {repo.language}
                            </span>
                          )}
                        </motion.a>
                      ))}
                    </div>
                  </motion.div>
                </div>
              </>
            )}
          </motion.div>
        )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
            <span className="font-bold">DevScore</span>
          </div>
          <p className="text-gray-400 text-sm">© 2026 DevScore Analyzer. Built for developers.</p>
        </div>
      </footer>
    </div>
  );
}
