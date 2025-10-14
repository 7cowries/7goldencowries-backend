import session from "express-session";

export function installSession(app, db) {
  app.use(session({
    name: "7gc.sid",
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    cookie: (()=>{
      const secure = process.env.NODE_ENV === "production";
      return { httpOnly:true, sameSite: secure ? "none" : "lax", secure, maxAge: 1000*60*60*24*30 };
    })()
  }));

  // Fallback: support dev cookie "7gc.sid=w:<wallet>" to materialize a session
  app.use(async (req, res, next) => {
    try {
      if (!req.session?.userId) {
        const ck = req.headers.cookie || "";
        const m = /(?:^|;\s*)7gc\.sid=([^;]+)/.exec(ck);
        if (m) {
          const raw = decodeURIComponent(m[1]);
          if (raw.startsWith("w:")) {
            const wallet = raw.slice(2).trim();
            if (wallet) {
              let row = await db.get("SELECT id FROM users WHERE wallet=?", wallet);
              let uid = row?.id;
              if (!uid) {
                await db.run("INSERT OR IGNORE INTO users(wallet) VALUES(?)", wallet);
                row = await db.get("SELECT id FROM users WHERE wallet=?", wallet);
                uid = row?.id;
              }
              if (uid) req.session.userId = uid;
            }
          }
        }
      }
    } catch {}
    next();
  });
}
