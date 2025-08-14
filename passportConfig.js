import passport from "passport";
import { Strategy as TwitterStrategy } from "passport-twitter";

passport.use(
  new TwitterStrategy(
    {
      consumerKey: process.env.TWITTER_CONSUMER_KEY,
      consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
      callbackURL: process.env.TWITTER_CALLBACK,
      includeEmail: true,
    },
    (token, tokenSecret, profile, done) => {
      // Pass full profile to callback
      return done(null, profile);
    }
  )
);

// Required for persistent login sessions
passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((obj, done) => {
  done(null, obj);
});
