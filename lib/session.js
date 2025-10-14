import session from "express-session";

function cookieSecure() {
  return process.env.NODE_ENV === "production";
}

export function installSession(app, db) {
  app.use(session({
    name: "7gc.sid",
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: cookieSecure() ? "none" : "lax",
      secure: cookieSecure(),
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  }));

  // Dev helper: accept cookie "7gc.sid=w:<wallet>" to materialize a session
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
              if (!row?.id) await db.run("INSERT OR IGNORE INTO users(wallet) VALUES(?)", wallet);
              row = await db.get("SELECT id FROM users WHERE wallet=?", wallet);
              if (row?.id) req.session.userId = row.id;
            }
          }
        }
      }
    } catch {}
    next();
  });
}
