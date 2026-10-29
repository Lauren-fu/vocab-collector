// Run on macOS with the built-in JavaScript engine (no Node needed):
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc extension/lib/sentence.js tests/sentence.test.js
const S = globalThis.VCSentence;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) print("ok   " + name);
  else { failed++; print("FAIL " + name + "\n     got:      " + a + "\n     expected: " + e); }
}

function sentenceOf(text, word, nth) {
  let start = -1;
  for (let i = 0; i <= (nth || 0); i++) start = text.indexOf(word, start + 1);
  const r = S.findSentence(text, start, start + word.length);
  check("word stays at its position: " + word, r.sentence.slice(r.wordStart, r.wordEnd), word);
  return r.sentence;
}

check("middle sentence",
  sentenceOf("I like tea. Phones are ubiquitous in cities now! What about you?", "ubiquitous"),
  "Phones are ubiquitous in cities now!");

check("first sentence",
  sentenceOf("Phones are ubiquitous. I like tea.", "ubiquitous"),
  "Phones are ubiquitous.");

check("no ending punctuation",
  sentenceOf("Title text\n  with a   stray word", "stray"),
  "Title text with a stray word");

check("abbreviation does not split",
  sentenceOf("We met Dr. Smith yesterday. He was meticulous about details.", "Smith"),
  "We met Dr. Smith yesterday.");

check("e.g. does not split",
  sentenceOf("Some fruits, e.g. mangoes, are succulent. Others are dry.", "succulent"),
  "Some fruits, e.g. mangoes, are succulent.");

check("closing quote stays",
  sentenceOf("He said, \"It is futile.\" Then he left.", "futile"),
  "He said, \"It is futile.\"");

check("decimal does not split",
  sentenceOf("The rate rose 3.5 percent, a modest gain. Next.", "modest"),
  "The rate rose 3.5 percent, a modest gain.");

check("initials do not split",
  sentenceOf("Books by J. K. Rowling are popular. Yes.", "popular"),
  "Books by J. K. Rowling are popular.");

const long = "word ".repeat(100) + "target " + "word ".repeat(100) + ".";
const lr = S.findSentence(long, long.indexOf("target"), long.indexOf("target") + 6);
check("long sentence is cut", lr.sentence.length < 400, true);
check("long sentence keeps word", lr.sentence.slice(lr.wordStart, lr.wordEnd), "target");
check("long sentence has ellipsis", lr.sentence.startsWith("…") && lr.sentence.endsWith("…"), true);

check("cleanWord quotes", S.cleanWord("“Ubiquitous,”"), { word: "Ubiquitous", lead: 1, trail: 2 });
check("cleanWord plain", S.cleanWord("tea"), { word: "tea", lead: 0, trail: 0 });

check("isWordLike word", S.isWordLike("ubiquitous"), true);
check("isWordLike phrase", S.isWordLike("give up"), true);
check("isWordLike apostrophe", S.isWordLike("rock’n’roll"), true);
check("isWordLike long", S.isWordLike("this is a whole sentence here"), false);
check("isWordLike number", S.isWordLike("2024"), false);

check("splitWords", S.splitWords("It's a well-known fact.").map(w => w.word), ["It's", "a", "well-known", "fact"]);

check("locateWord nearest", S.locateWord("Run, run, RUN away", "run", 10), { start: 10, end: 13 });
check("locateWord whole word only", S.locateWord("Brunch is fun. Run!", "run", 0), { start: 15, end: 18 });
check("locateWord missing", S.locateWord("Nothing here", "tea", 0), null);
check("locateWord phrase", S.locateWord("Never give  up hope", "give up", 0), { start: 6, end: 14 });

print(failed ? "\n" + failed + " FAILED" : "\nAll tests passed");
