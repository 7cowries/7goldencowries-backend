// passportConfig.js
import passport from "passport";
import { Strategy as TwitterStrategy } from "passport-twitter";

// Expect these env names (match your .env screenshot)
const TWITTER_CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY;
const TWITTER_CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET;
const TWITTER_CALLBACK =
  process.env.TWITTER_CALLBACK ||
  `${process.env.BACKEND_URL || ""}/auth/twitter/callback`;

if (!TWITTER_CONSUMER_KEY || !TWITTER_CONSUMER_SECRET) {
  console.warn("⚠️ Twitter keys missing — Twitter auth disabled");
} else {
  passport.use(
    new TwitterStrategy(
      {
        consumerKey: TWITTER_CONSUMER_KEY,
        consumerSecret: TWITTER_CONSUMER_SECRET,
        callbackURL: TWITTER_CALLBACK,
        includeEmail: false,
      },
      (_token, _tokenSecret, profile, done) => {
        // we only need username for linking
        const user = {
          id: profile.id,
          username: profile.username, // shown as handle
        };
        return done(null, user);
      }
    )
  );
}

passport.serializeUser((user, cb) => cb(null, user));
passport.deserializeUser((obj, cb) => cb(null, obj));

export default passport;
