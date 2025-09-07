export function inferVendor(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
    if (host.includes('t.me') || host.includes('telegram')) return 'telegram';
    if (host.includes('discord.gg') || host.includes('discordapp.com') || host.includes('discord.com')) return 'discord';
    return host;
  } catch {
    return null;
  }
}

export default inferVendor;
