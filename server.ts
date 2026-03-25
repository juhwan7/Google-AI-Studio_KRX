import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import cron from "node-cron";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { formatInTimeZone } from "date-fns-tz";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

console.log("Starting server initialization...");
const app = express();
const PORT = 3000;

let db: admin.firestore.Firestore | null = null;

// Start listening immediately so the port is open and API routes are available
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

console.log("NODE_ENV:", process.env.NODE_ENV);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.json());

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    firebaseInitialized: !!db,
    env: process.env.NODE_ENV,
    time: new Date().toISOString()
  });
});

// Market Hours: 09:00 - 15:30 KST
// Cron: Every 30 minutes from 09:30 to 15:30
// 30,0 9-15 * * 1-5  (Mon-Fri, 09:30, 10:00, ..., 15:30)
// We'll use a more flexible cron and check time inside
cron.schedule("0,30 9-15 * * 1-5", async () => {
  const now = new Date();
  const kstTime = formatInTimeZone(now, "Asia/Seoul", "HH:mm");
  const [hours, minutes] = kstTime.split(":").map(Number);

  // Only run between 09:30 and 15:30
  if (hours === 9 && minutes < 30) return;
  if (hours === 15 && minutes > 30) return;

  console.log(`[${kstTime}] Running market data snapshot...`);
  await runSnapshot();
});

async function fetchMarketData(sosok: number) {
  const marketName = sosok === 0 ? 'KOSPI' : 'KOSDAQ';
  console.log(`[FETCH] Starting market data fetch for ${marketName}...`);
  try {
    // sosok=0: KOSPI, sosok=1: KOSDAQ
    const url = `https://finance.naver.com/sise/sise_trans_style.naver?sosok=${sosok}`;
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    const html = new TextDecoder('euc-kr').decode(data);
    const $ = cheerio.load(html);

    const row = $("table.type_1 tbody tr").filter((i, el) => $(el).find("td").length > 3).first();
    
    if (!row.length) {
      console.error(`[ERROR] No data row found in HTML for ${marketName}. Check if Naver Finance page structure has changed.`);
      return { individual: null, foreign: null, institutional: null };
    }

    const parseVal = (index: number, name: string) => {
      try {
        const cell = row.find("td").eq(index);
        if (!cell.length) {
          console.error(`[ERROR] Failed to find ${marketName} ${name} data cell at index ${index}`);
          return null;
        }
        const text = cell.text().replace(/[^0-9-]/g, "");
        if (!text) {
          console.warn(`[WARN] Empty ${name} data for ${marketName} at index ${index}`);
          return null;
        }
        const val = parseInt(text);
        if (isNaN(val)) {
          console.error(`[ERROR] Failed to parse ${marketName} ${name} value: "${text}"`);
          return null;
        }
        return val;
      } catch (e: any) {
        console.error(`[ERROR] Exception while parsing ${marketName} ${name} data:`, e.message);
        return null;
      }
    };

    const individual = parseVal(1, 'individual');
    const foreign = parseVal(2, 'foreign');
    const institutional = parseVal(3, 'institutional');

    console.log(`[SUCCESS] Fetched Market Data (${marketName}):`, { individual, foreign, institutional });
    return { individual, foreign, institutional };
  } catch (error: any) {
    console.error(`[FATAL] Error fetching market data for ${marketName}:`, error.message);
    return { individual: null, foreign: null, institutional: null };
  }
}

async function fetchProgramData(sosok: number) {
  const marketName = sosok === 0 ? 'KOSPI' : 'KOSDAQ';
  console.log(`[FETCH] Starting program data fetch for ${marketName}...`);
  try {
    // sosok=0: KOSPI, sosok=1: KOSDAQ
    const url = `https://finance.naver.com/sise/sise_program.naver?sosok=${marketName}`;
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      responseType: 'arraybuffer',
      timeout: 10000
    });
    const html = new TextDecoder('euc-kr').decode(data);
    const $ = cheerio.load(html);

    // 비차익 순매수 (Non-arbitrage net buy)
    // The table usually has headers, we want the first data row
    const row = $(".type_1 tbody tr").filter((i, el) => $(el).find("td").length > 4).first();
    
    if (!row.length) {
      console.error(`[ERROR] No program data row found in HTML for ${marketName}.`);
      return null;
    }

    try {
      const cell = row.find("td").eq(4);
      if (!cell.length) {
        console.error(`[ERROR] Failed to find ${marketName} program data cell at index 4`);
        return null;
      }
      const text = cell.text().replace(/[^0-9-]/g, "");
      if (!text) {
        console.warn(`[WARN] Empty program data for ${marketName}`);
        return null;
      }

      const nonArbitrage = parseInt(text);
      if (isNaN(nonArbitrage)) {
        console.error(`[ERROR] Failed to parse ${marketName} program value: "${text}"`);
        return null;
      }
      console.log(`[SUCCESS] Fetched Program Data (${marketName}):`, nonArbitrage);
      return nonArbitrage;
    } catch (e: any) {
      console.error(`[ERROR] Exception while parsing ${marketName} program data:`, e.message);
      return null;
    }
  } catch (error: any) {
    console.error(`[FATAL] Error fetching program data for ${marketName}:`, error.message);
    return null;
  }
}

async function runSnapshot() {
  try {
    // Fetch all data in parallel
    const [kospiData, kospiProgram, kosdaqData, kosdaqProgram] = await Promise.all([
      fetchMarketData(0),
      fetchProgramData(0),
      fetchMarketData(1),
      fetchProgramData(1)
    ]);

    const snapshot = {
      timestamp: Date.now(),
      kospi: { ...kospiData, program_non_arbitrage: kospiProgram },
      kosdaq: { ...kosdaqData, program_non_arbitrage: kosdaqProgram }
    };

    // Save to Firestore if available
    if (db) {
      try {
        await db.collection("snapshots").add(snapshot);
        console.log("Snapshot saved to Firestore.");
      } catch (dbError: any) {
        console.error("Failed to save snapshot to Firestore:", dbError.message);
      }
    } else {
      console.warn("Skipping Firestore save: Database not initialized.");
    }

    // Send Telegram Notification (always try)
    await sendTelegramNotification(snapshot);
  } catch (error) {
    console.error("Error in runSnapshot:", error);
  }
}

async function sendTelegramNotification(current: any) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn("Telegram Bot Token or Chat ID not configured.");
    return;
  }

  if (!db) {
    console.error("sendTelegramNotification failed: Firebase not initialized.");
    return;
  }

  // Get historical data (30m and 1h ago)
  let history: any[] = [];
  if (db) {
    try {
      const querySnapshot = await db.collection("snapshots")
        .orderBy("timestamp", "desc")
        .limit(5)
        .get();
      history = querySnapshot.docs.map(doc => doc.data());
    } catch (e) {
      console.warn("Could not fetch history for Telegram message:", e.message);
    }
  }
  
  const prev30m = history[1]; // 2nd most recent
  const prev1h = history[2];  // 3rd most recent

  const formatValue = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "N/A";
    return (val / 100).toFixed(0);
  };
  
  const getDiff = (curr: number | null | undefined, prev: number | null | undefined) => {
    if (curr === null || curr === undefined || prev === null || prev === undefined) return "N/A";
    const diff = curr - prev;
    return (diff > 0 ? "+" : "") + (diff / 100).toFixed(1);
  };

  const kstTime = formatInTimeZone(new Date(current.timestamp), "Asia/Seoul", "HH:mm");

  let message = `📊 [${kstTime}] 수급 현황 (단위: 억)\n\n`;

  // KOSPI
  message += `🔹 KOSPI\n`;
  message += `개인: ${formatValue(current.kospi.individual)} (${getDiff(current.kospi.individual, prev30m?.kospi?.individual)} / ${getDiff(current.kospi.individual, prev1h?.kospi?.individual)})\n`;
  message += `외인: ${formatValue(current.kospi.foreign)} (${getDiff(current.kospi.foreign, prev30m?.kospi?.foreign)} / ${getDiff(current.kospi.foreign, prev1h?.kospi?.foreign)})\n`;
  message += `기관: ${formatValue(current.kospi.institutional)} (${getDiff(current.kospi.institutional, prev30m?.kospi?.institutional)} / ${getDiff(current.kospi.institutional, prev1h?.kospi?.institutional)})\n`;
  message += `비차익: ${formatValue(current.kospi.program_non_arbitrage)} (${getDiff(current.kospi.program_non_arbitrage, prev30m?.kospi?.program_non_arbitrage)} / ${getDiff(current.kospi.program_non_arbitrage, prev1h?.kospi?.program_non_arbitrage)})\n\n`;

  // KOSDAQ
  message += `🔸 KOSDAQ\n`;
  message += `개인: ${formatValue(current.kosdaq.individual)} (${getDiff(current.kosdaq.individual, prev30m?.kosdaq?.individual)} / ${getDiff(current.kosdaq.individual, prev1h?.kosdaq?.individual)})\n`;
  message += `외인: ${formatValue(current.kosdaq.foreign)} (${getDiff(current.kosdaq.foreign, prev30m?.kosdaq?.foreign)} / ${getDiff(current.kosdaq.foreign, prev1h?.kosdaq?.foreign)})\n`;
  message += `기관: ${formatValue(current.kosdaq.institutional)} (${getDiff(current.kosdaq.institutional, prev30m?.kosdaq?.institutional)} / ${getDiff(current.kosdaq.institutional, prev1h?.kosdaq?.institutional)})\n`;
  message += `비차익: ${formatValue(current.kosdaq.program_non_arbitrage)} (${getDiff(current.kosdaq.program_non_arbitrage, prev30m?.kosdaq?.program_non_arbitrage)} / ${getDiff(current.kosdaq.program_non_arbitrage, prev1h?.kosdaq?.program_non_arbitrage)})\n\n`;

  message += `(괄호: 30분전 대비 / 1시간전 대비)`;

  try {
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message
    });
    console.log("Telegram message sent successfully:", response.data);
  } catch (error: any) {
    if (error.response) {
      console.error("Telegram API Error:", error.response.data);
    } else {
      console.error("Error sending Telegram message:", error.message);
    }
  }
}

// API Routes
app.get("/api/status", async (req, res) => {
  console.log(`[${new Date().toISOString()}] Handling /api/status request`);
  try {
    if (!db) {
      console.warn("Firestore not initialized, returning 503");
      return res.status(503).json({ 
        status: "error", 
        error: "Firebase not initialized. Check server logs.",
        botConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
      });
    }

    const dbId = db ? ((db as any)._databaseId || "(default)") : "none";
    console.log(`[${new Date().toISOString()}] Attempting to fetch latest snapshot from Firestore (DB: ${dbId})...`);
    
    let latestSnapshot = null;
    let dbStatus = "connected";

    if (db) {
      try {
        const querySnapshot = await db.collection("snapshots")
          .orderBy("timestamp", "desc")
          .limit(1)
          .get();
        latestSnapshot = querySnapshot.empty ? null : querySnapshot.docs[0].data();
        console.log(`Successfully fetched latest snapshot from ${dbId}.`);
      } catch (queryError: any) {
        console.error(`Firestore query failed on ${dbId}:`, queryError.message);
        dbStatus = "error";
      }
    } else {
      dbStatus = "not_initialized";
    }
    
    res.json({ 
      status: "running", 
      botConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      latestSnapshot,
      databaseId: dbId,
      databaseStatus: dbStatus
    });
  } catch (error: any) {
    console.error("Status fetch error details:", error);
    res.json({ 
      status: "running",
      botConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      error: "Database connection failed. Historical data is unavailable.",
      details: error.message
    });
  }
});

app.post("/api/trigger", async (req, res) => {
  try {
    console.log("Manual trigger received.");
    await runSnapshot();
    res.json({ message: "Snapshot triggered manually. Check Telegram!" });
  } catch (error: any) {
    console.error("Manual trigger error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/test-telegram", async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(400).json({ error: "Telegram config missing in Secrets." });
  }

  try {
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: "🔔 텔레그램 연결 테스트 성공! 이제 주식 수급 알림을 받으실 수 있습니다."
    });
    res.json({ message: "Test message sent!", data: response.data });
  } catch (error: any) {
    console.error("Telegram Test Error:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Express Global Error:", err);
  res.status(500).json({ error: "Internal Server Error", details: err.message });
});

async function initializeFirebase() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
      
      if (!admin.apps.length) {
        console.log(`Initializing Firebase Admin with Project ID from config: ${firebaseConfig.projectId}`);
        console.log("Environment Project IDs:", {
          PROJECT_ID: process.env.PROJECT_ID,
          GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
          FIREBASE_CONFIG: process.env.FIREBASE_CONFIG ? "exists" : "missing"
        });
        
        // In AI Studio, we should prioritize the project ID from the config
        admin.initializeApp({
          projectId: firebaseConfig.projectId,
        });
      }
      
      // Try to use the named database first
      if (firebaseConfig.firestoreDatabaseId) {
        try {
          console.log(`Attempting to connect to named database: ${firebaseConfig.firestoreDatabaseId}`);
          const namedDb = getFirestore(firebaseConfig.firestoreDatabaseId);
          // Test if the named database exists and is accessible
          await namedDb.collection("snapshots").limit(1).get();
          db = namedDb;
          console.log(`Successfully connected to named Firestore database: ${firebaseConfig.firestoreDatabaseId}`);
        } catch (dbError: any) {
          console.warn(`Named database ${firebaseConfig.firestoreDatabaseId} failed or not found:`, dbError.message);
          console.log("Falling back to default database...");
          db = getFirestore();
        }
      } else {
        console.log("No named database ID provided, using default database.");
        db = getFirestore();
      }
      
      // Final verification of the selected database
      try {
        const testSnapshot = await db.collection("snapshots").limit(1).get();
        const activeDbId = (db as any)._databaseId || "(default)";
        console.log(`Firestore connection verified on database: ${activeDbId}. Empty: ${testSnapshot.empty}`);
      } catch (finalError: any) {
        console.error("Final Firestore connection test failed:", finalError.message);
        
        // If even the fallback failed, try to re-initialize with environment project ID if different
        const envProjectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
        if (envProjectId && envProjectId !== firebaseConfig.projectId) {
          console.log(`Emergency: Trying environment project ID: ${envProjectId}`);
          try {
            // We can't easily re-initialize the default app with a different project ID in firebase-admin
            // but we can create a secondary app
            if (!admin.apps.find(a => a?.name === "emergency")) {
              const emergencyApp = admin.initializeApp({
                projectId: envProjectId,
              }, "emergency");
              const emergencyDb = getFirestore(emergencyApp);
              await emergencyDb.collection("snapshots").limit(1).get();
              db = emergencyDb;
              console.log(`Emergency: Successfully connected to database in environment project: ${envProjectId}`);
            }
          } catch (emergencyError: any) {
            console.error("Emergency fallback also failed:", emergencyError.message);
          }
        }
      }
    } else {
      console.warn("firebase-applet-config.json not found. Firebase features will be disabled.");
    }
  } catch (error) {
    console.error("Error initializing Firebase Admin:", error);
  }
}

async function setupMiddleware() {
  console.log("Setting up middleware and starting server...");
  
  await initializeFirebase();

  if (process.env.NODE_ENV !== "production") {
    console.log("Configuring Vite middleware...");
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware attached.");
    } catch (viteError) {
      console.error("Failed to start Vite server:", viteError);
    }
  } else {
    console.log("Configuring production static file serving...");
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        if (!req.url.startsWith("/api/")) {
          res.sendFile(path.join(distPath, "index.html"));
        } else {
          res.status(404).json({ error: "API route not found" });
        }
      });
      console.log("Static files configured at:", distPath);
    } else {
      console.warn("WARNING: dist folder not found. Static file serving may fail.");
    }
  }
}

// Initial setup
setupMiddleware();
