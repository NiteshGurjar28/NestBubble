// ===== Real-estate & Safety rules in ONE util =====

// ---------- SAFETY (nudity / racy / violence) ----------
const RANK = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 1,
  UNLIKELY: 2,
  POSSIBLE: 3,
  LIKELY: 4,
  VERY_LIKELY: 5,
};

// Labels that should cause a block when Vision detects them confidently
export const BAD_LABEL_KEYWORDS = new Set([
  "Nudity",
  "Nude",
  "Underwear",
  "Lingerie",
  "Pornography",
  "Sex",
  "Sexual intercourse",
  "Sex toy",
  "Genitals",
  "Breast",
  "Buttocks",
  "Blood",
  "Violence",
  "Gun",
  "Rifle",
  "Weapon",
  "Knife",
  "Drugs",
  "Cigarette",
  "Vape",
]);

/**
 * Strict SafeSearch policy (default).
 * - ADULT >= LIKELY       -> block
 * - RACY  >= LIKELY       -> block
 * - VIOLENCE >= LIKELY    -> block
 * Tweaks: pass { adultMin:"VERY_LIKELY", racyMin:"LIKELY", violenceMin:"LIKELY" }
 */
export function isImageSafe({
  safeSearch,
  labels = [],
  labelMinScore = 0.65,
  policy,
} = {}) {
  const adultMin = policy?.adultMin || "LIKELY";
  const racyMin = policy?.racyMin || "LIKELY";
  const violenceMin = policy?.violenceMin || "LIKELY";

  // 1) SafeSearch gates
  if (safeSearch) {
    const { adult, racy, violence } = safeSearch;
    if (RANK[adult || "UNKNOWN"] >= RANK[adultMin]) {
      return { ok: false, reason: "Unsafe content (adult)" };
    }
    if (RANK[racy || "UNKNOWN"] >= RANK[racyMin]) {
      return { ok: false, reason: "Unsafe content (racy)" };
    }
    if (RANK[violence || "UNKNOWN"] >= RANK[violenceMin]) {
      return { ok: false, reason: "Unsafe content (violence)" };
    }
  }

  // 2) Bad labels net (optional but useful)
  for (const l of labels) {
    const name = (l.description || "").trim();
    const score = l.score || 0;
    if (score >= labelMinScore && BAD_LABEL_KEYWORDS.has(name)) {
      return { ok: false, reason: `Unsafe content (label: ${name})` };
    }
  }

  return { ok: true, reason: "Safe" };
}

export function summarizeSafeSearch(safeSearch) {
  if (!safeSearch) return null;
  const { adult, racy, violence, medical, spoof } = safeSearch;
  return { adult, racy, violence, medical, spoof };
}

// ---------- HOME / REAL-ESTATE CLASSIFIER ----------
export const STRONG_HOME_KEYWORDS = new Set([
  "House",
  "Home",
  "Villa",
  "Apartment",
  "Flat",
  "Condominium",
  "Residential building",
  "Residential area",
  "Property",
  "Real estate",
]);

export const AUX_HOME_KEYWORDS = new Set([
  "Architecture",
  "Building",
  "Facade",
  "Balcony",
  "Door",
  "Window",
  "Roof",
  "Patio",
  "Courtyard",
  "Driveway",
  "Garden",
  "Fence",
  "Townhouse",
  "Cottage",
  "Farmhouse",
  "Swimming pool",
  "Resort",
  "Hotel",
  "Estate",
  "Skyscraper",
  "High-rise building",
  "Commercial building",
  "Cityscape",
]);

// OCR: accept if signage contains any of these
const OCR_PATTERN =
  /\b(villa|house|home|apartment|flat|condo|minium|resort|hotel|real\s*estate|residence|residential)\b/i;

// Web entities that strongly suggest property context
const WEB_HOME_TERMS = new Set([
  "House",
  "Home",
  "Villa",
  "Apartment",
  "Real estate",
  "Residence",
  "Building",
  "Architecture",
]);

/**
 * Decide if image is related to homes/real-estate.
 * Accepts a single object arg with the richer signals.
 */
export function isHomeRelated({
  labels = [],
  webEntities = [],
  ocrText = "",
  objects = [],
} = {}) {
  // 1) OCR hit -> accept
  if (ocrText && OCR_PATTERN.test(ocrText)) {
    return { ok: true, reason: "OCR shows real-estate term" };
  }

  // Build stats from labels
  let maxStrong = 0;
  let sumStrong = 0;
  let auxHits = 0;

  for (const l of labels) {
    const name = (l.description || "").trim();
    const score = l.score || 0;
    if (STRONG_HOME_KEYWORDS.has(name)) {
      maxStrong = Math.max(maxStrong, score);
      sumStrong += score;
    }
    if (AUX_HOME_KEYWORDS.has(name) && score >= 0.55) {
      auxHits += 1;
    }
  }

  // 2) single strong >= 0.55 (Airbnb-friendly)
  if (maxStrong >= 0.55) return { ok: true, reason: "Strong label ≥ 0.55" };

  // 3) cumulative strong >= 1.10
  if (sumStrong >= 1.1) return { ok: true, reason: "Cumulative home evidence" };

  // 4) web entities suggest property context
  for (const w of webEntities) {
    const name = (w.description || "").trim();
    const score = w.score || 0;
    if (WEB_HOME_TERMS.has(name) && score >= 0.5) {
      return { ok: true, reason: "Web entity indicates property" };
    }
  }

  // 5) contextual: some strong + multiple aux cues
  if (maxStrong >= 0.45 && auxHits >= 2) {
    return { ok: true, reason: "Contextual architecture cues" };
  }

  return { ok: false, reason: "Insufficient home-related evidence" };
}

/**
 * Optional convenience: run safety first, then home classification.
 * You can call this directly with Vision's annotation pieces.
 */
export function evaluateRealEstateImage({
  safeSearch,
  labels = [],
  webEntities = [],
  ocrText = "",
  objects = [],
} = {}) {
  const safety = isImageSafe({ safeSearch, labels });
  if (!safety.ok) {
    return { accepted: false, reason: safety.reason, safety };
  }
  const home = isHomeRelated({ labels, webEntities, ocrText, objects });
  return {
    accepted: home.ok,
    reason: home.ok ? home.reason : "Insufficient home-related evidence",
    safety,
    home,
  };
}
