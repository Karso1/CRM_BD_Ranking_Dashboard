const publicWalletBds = new Set(["victor", "katrina", "ruslan", "mike", "patrick", "richard", "marketing", "upay"]);

const normalized = (value: string) => value.normalize("NFKC").trim().toLowerCase();

export function displayedOwner(platform: "business" | "wallet", rawOwner: string, name = "") {
  if (platform !== "wallet") return rawOwner;
  // The grouped catch-all is a public label regardless of its source owner.
  if (name.startsWith("UPay · ")) return "UPay";
  return publicWalletBds.has(normalized(rawOwner)) ? rawOwner.trim() : "UPay";
}

export function entityIdentity(platform: "business" | "wallet", name: string, owner: string, type: string) {
  return [name, displayedOwner(platform, owner, name), type]
    .map(value => value.normalize("NFKC").trim().toLowerCase())
    .join("\u0000");
}
