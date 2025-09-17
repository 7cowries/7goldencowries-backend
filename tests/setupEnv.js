if (!process.env.SQLITE_FILE) {
  process.env.SQLITE_FILE = process.env.DATABASE_URL || ':memory:';
}
process.env.DATABASE_URL = process.env.SQLITE_FILE;
process.env.SUBSCRIPTION_WEBHOOK_SECRET ??= 'test-subscription-secret';
process.env.TOKEN_SALE_WEBHOOK_SECRET ??= 'test-token-sale-secret';
process.env.TWITTER_CONSUMER_KEY ??= 'test-twitter-key';
process.env.TWITTER_CONSUMER_SECRET ??= 'test-twitter-secret';
