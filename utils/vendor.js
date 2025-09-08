export function inferVendor(url = "") {
  try {
    const str = String(url);
    if (/(twitter|x)\.com\/[^/]+\/status\/\d+/i.test(str)) return "twitter";
    if (/t\.me\/.+/i.test(str)) return "telegram";
    if (/(discord\.gg|discord\.com\/invite|discord\.com\/channels)/i.test(str)) return "discord";
    // generic link
    return "link";
  } catch {
    return null;
  }
}

export default inferVendor;
