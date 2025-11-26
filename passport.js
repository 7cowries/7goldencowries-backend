// passport.js
import passport from "passport";
import { Strategy as TwitterStrategy } from "passport-twitter";

const cb =
  process.env.TWITTER_CALLBACK ||
  `${process.env.BACKEND_URL || "https://sevengoldencowries-backend.onrender.com"}/api/auth/twitter/callback`;

passport.use(
  new TwitterStrategy(
    {
      consumerKey: process.env.TWITTER_CONSUMER_KEY,
      consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
      callbackURL: cb,
      includeEmail: false
    },
    (_token, _tokenSecret, profile, done) => {
      // Keep only what we need
      done(null, { id: profile.id, username: profile.username });
    }
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

export default passport;
