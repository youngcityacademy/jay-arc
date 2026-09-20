const QUOTE_ROTATION = [
  { text: "Talent without working hard is nothing.", author: "Cristiano Ronaldo", role: "footballer" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant", role: "historian and philosopher" },
  { text: "I start early and I stay late, day after day, year after year. It took me 17 years and 114 days to become an overnight success.", author: "Lionel Messi", role: "footballer" },
  { text: "Genius is one percent inspiration and ninety-nine percent perspiration.", author: "Thomas Edison", role: "inventor" },
  { text: "Playing football is very simple, but playing simple football is the hardest thing there is.", author: "Johan Cruyff", role: "footballer" },
  { text: "Ever tried. Ever failed. No matter. Try again. Fail again. Fail better.", author: "Samuel Beckett", role: "writer" },
  { text: "Success is no accident. It is hard work, perseverance, learning, studying, sacrifice and most of all, love of what you are doing or learning to do.", author: "Pelé", role: "footballer" },
  { text: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius", role: "Roman emperor and philosopher" },
  { text: "I am building a fire, and every day I train, I add more fuel. At just the right moment, I light the match.", author: "Mia Hamm", role: "footballer" },
  { text: "A journey of a thousand miles begins with a single step.", author: "Lao Tzu", role: "philosopher" },
  { text: "Every disadvantage has its advantage.", author: "Johan Cruyff", role: "footballer" },
  { text: "Well done is better than well said.", author: "Benjamin Franklin", role: "scientist and writer" },
  { text: "Everything is practice.", author: "Pelé", role: "footballer" },
  { text: "Strive not to be a success, but rather to be of value.", author: "Albert Einstein", role: "physicist" }
];

window.addEventListener("load", function () {
  const quoteEl = document.getElementById("dailyQuote");
  const authorEl = document.getElementById("quoteAuthor");
  if (!quoteEl || !authorEl) return;

  const now = new Date();
  const dayNumber = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  const quote = QUOTE_ROTATION[dayNumber % QUOTE_ROTATION.length];
  quoteEl.textContent = quote.text;
  authorEl.textContent = `${quote.author}, ${quote.role}`;
});
