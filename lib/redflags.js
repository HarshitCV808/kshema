// Deterministic emergency screen run on every chat message before the AI sees it.
// The AI's reply is never the only safety net: a match always shows the emergency
// card in the page, whatever the model says.
// Covers English, Kannada, Hindi, and common romanised spellings of both.
// shortcut: keyword matching misses unusual phrasings; the system prompt is the second layer.

const RULES = [
  {
    kind: "heart",
    re: [
      /chest (pain|pressure|tightness|heaviness)|pain in (my |the )?chest|heart (attack|pain)|pain (in|down) (my |the )?left arm|left arm (pain|numb)/,
      /ಎದೆ ?ನೋವು|ಎದೆಯಲ್ಲಿ ನೋವು|ಹೃದಯಾಘಾತ/,
      /(सीने|छाती) (में|मे) दर्द|दिल का दौरा|हार्ट अटैक/,
      /(seene|sine|chhati|chati) (me|mein|mai) dard|ede ?novu/,
    ],
  },
  {
    kind: "breathing",
    re: [
      /can'?t breathe|cannot breathe|(difficulty|trouble|hard) (in )?breathing|short(ness)? of breath|breathless|gasping|choking|lips (are |look |turning )?blue/,
      /ಉಸಿರಾಡಲು (ಆಗುತ್ತಿಲ್ಲ|ಕಷ್ಟ)|ಉಸಿರಾಟದ ತೊಂದರೆ|ಉಸಿರು ಕಟ್ಟ/,
      /सांस (लेने में )?(तकलीफ|दिक्कत|नहीं)|साँस (लेने में )?(तकलीफ|दिक्कत|नहीं)|सांस फूल|साँस फूल|दम घुट/,
      /saa?ns (lene me |lene mein )?(nahi|takleef|dikkat)|saa?ns phool|usiru kattu/,
    ],
  },
  {
    kind: "stroke",
    re: [
      /stroke|face (is )?droop|slurred speech|one side (of (my|the|his|her) (body|face) )?(is )?(weak|numb)|sudden (weakness|numbness|confusion)|can'?t (speak|move (my|his|her) (arm|leg))/,
      /worst headache|sudden (severe|terrible) headache|stiff neck/,
      /ಪಾರ್ಶ್ವವಾಯು|ಲಕ್ವ|ಮಾತು ತೊದಲ/,
      /लकवा|आधा शरीर|बोलने में (तकलीफ|दिक्कत)|मुंह टेढ़ा/,
      /lakwa|laqwa|paralysis/,
    ],
  },
  {
    kind: "unconscious",
    re: [
      /unconscious|passed out|not waking up|unresponsive|fainted|collapsed/,
      /ಪ್ರಜ್ಞೆ ತಪ್ಪ|ಎಚ್ಚರ ಇಲ್ಲ|ಮೂರ್ಛೆ ಹೋಗ/,
      /बेहोश|होश नहीं/,
      /behosh/,
    ],
  },
  {
    kind: "seizure",
    re: [/seizure|convulsion|\bfits\b/, /ಸೆಳೆತ|ಫಿಟ್ಸ್|ಮೂರ್ಛೆ ರೋಗ/, /मिर्गी|दौरे पड़|झटके आ/, /mirgi/],
  },
  {
    kind: "bleeding",
    re: [
      /(heavy|severe|won'?t stop|not stopping) bleeding|bleeding (heavily|a lot|won'?t stop)|vomiting blood|coughing (up )?blood|blood in vomit/,
      /pregnan\w*.{0,40}(bleed|severe pain)|(bleed\w*|severe pain).{0,40}pregnan/,
      /ತುಂಬಾ ರಕ್ತ|ರಕ್ತಸ್ರಾವ|ರಕ್ತ ವಾಂತಿ/,
      /बहुत खून|खून (बह|नहीं रुक)|खून की उल्टी/,
      /khoon (beh|nahi ruk)/,
    ],
  },
  {
    kind: "selfharm",
    re: [
      /suicid|kill (my)?self|end (my life|it all)|want to die|don'?t want to live|no reason to live|self[- ]harm|hurt myself/,
      /ಆತ್ಮಹತ್ಯೆ|ಸಾಯಬೇಕು|ಸಾಯಲು|ಬದುಕಲು ಇಷ್ಟವಿಲ್ಲ/,
      /आत्महत्या|खुदकुशी|मरना चाहत|जान दे|जीना नहीं चाहत/,
      /khudkushi|marna chahta|marna chahti|jeena nahi chahta|sayabeku/,
    ],
  },
  {
    kind: "poison",
    re: [
      /overdose|(swallowed|drank|drunk|consumed|ate) (some |the )?(poison|pesticide|bleach|acid|rat poison|kerosene)|took too many (pills|tablets)|poison(ed|ing)|snake ?bite|bitten by a snake/,
      /ವಿಷ (ಕುಡಿ|ಸೇವ)|ಹೆಚ್ಚು ಮಾತ್ರೆ|ಹಾವು ಕಚ್ಚ/,
      /ज़हर|जहर|कीटनाशक|बहुत सारी गोलियां|सांप (ने )?काट|साँप (ने )?काट/,
      /zeher|jahar|saa?np (ne )?kaat/,
    ],
  },
  {
    kind: "allergy",
    re: [
      /(throat|tongue|lips?|face) (is )?(swelling|swollen|closing)|anaphyla/,
      /ಗಂಟಲು ಊದ|ನಾಲಿಗೆ ಊದ/,
      /गला (सूज|बंद)|जीभ सूज/,
    ],
  },
  {
    kind: "injury",
    re: [
      /\baccident\b|head injury|hit (my|his|her) head|fell from (a |the )?(height|terrace|roof|stairs)|severe burn|burnt badly/,
      /ಅಪಘಾತ|ತಲೆಗೆ ಪೆಟ್ಟು/,
      /दुर्घटना|एक्सीडेंट|सिर में चोट|बुरी तरह जल/,
    ],
  },
];

// "no chest pain", "without breathing trouble": an English negation just before the match.
const NEGATED = /\b(no|not|never|without|denies|don'?t have|doesn'?t have)\s+(any\s+)?$/;

export function findRedFlags(text) {
  const s = String(text || "").toLowerCase();
  const hit = (re) => {
    const g = new RegExp(re.source, "g");
    for (let m; (m = g.exec(s)); g.lastIndex = m.index + 1) {
      if (!NEGATED.test(s.slice(Math.max(0, m.index - 24), m.index))) return true;
    }
    return false;
  };
  return RULES.filter((r) => r.re.some(hit)).map((r) => r.kind);
}
