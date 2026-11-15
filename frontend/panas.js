// ===== ASTRA HEALTH - PANAS page =====

// ===== PANAS questionnaire =====
// 20 feelings in the original PANAS order.
// type "positive" = Positive Affect, "negative" = Negative Affect
const panasItems = [
  { word: "Interested",   type: "positive" },
  { word: "Distressed",   type: "negative" },
  { word: "Excited",      type: "positive" },
  { word: "Upset",        type: "negative" },
  { word: "Strong",       type: "positive" },
  { word: "Guilty",       type: "negative" },
  { word: "Scared",       type: "negative" },
  { word: "Hostile",      type: "negative" },
  { word: "Enthusiastic", type: "positive" },
  { word: "Proud",        type: "positive" },
  { word: "Irritable",    type: "negative" },
  { word: "Alert",        type: "positive" },
  { word: "Ashamed",      type: "negative" },
  { word: "Inspired",     type: "positive" },
  { word: "Nervous",      type: "negative" },
  { word: "Determined",   type: "positive" },
  { word: "Attentive",    type: "positive" },
  { word: "Jittery",      type: "negative" },
  { word: "Active",       type: "positive" },
  { word: "Afraid",       type: "negative" }
];

const panasRows = document.getElementById("panasRows");
const panasAnswered = document.getElementById("panasAnswered");
const panasPositive = document.getElementById("panasPositive");
const panasNegative = document.getElementById("panasNegative");

// Create one table row per feeling, with 5 radio buttons (1 to 5)
panasItems.forEach(function (item, index) {
  const row = document.createElement("tr");
  let cells = "<td>" + item.word + "</td>";

  for (let value = 1; value <= 5; value++) {
    cells += '<td><input type="radio" name="panas' + index + '" value="' + value +
             '" aria-label="' + item.word + ' ' + value + '"></td>';
  }

  row.innerHTML = cells;
  panasRows.appendChild(row);
});

// Calculate the scores every time an answer changes
function calculatePanas() {
  let answered = 0;
  let positive = 0;
  let negative = 0;

  panasItems.forEach(function (item, index) {
    const checked = document.querySelector('input[name="panas' + index + '"]:checked');

    if (checked) {
      answered = answered + 1;
      const value = Number(checked.value);

      if (item.type === "positive") {
        positive = positive + value;
      } else {
        negative = negative + value;
      }
    }
  });

  panasAnswered.textContent = answered;

  // Scores are only shown when all 20 items are answered
  if (answered === panasItems.length) {
    panasPositive.textContent = positive;
    panasNegative.textContent = negative;
  } else {
    panasPositive.textContent = "-";
    panasNegative.textContent = "-";
  }

  return answered;
}

panasRows.addEventListener("change", calculatePanas);

// ===== Save and return to check-in =====
// For now the result is saved in sessionStorage (only in this browser tab).
// Later it can be sent to the database with PHP.
const saveBtn = document.getElementById("saveBtn");
const panasMessage = document.getElementById("panasMessage");

saveBtn.addEventListener("click", function () {
  const answered = calculatePanas();

  if (answered < panasItems.length) {
    panasMessage.textContent = "Please answer all 20 items (" + answered + "/20 answered).";
    return;
  }

  const result = {
    positive: Number(panasPositive.textContent),
    negative: Number(panasNegative.textContent)
  };
  sessionStorage.setItem("panasResult", JSON.stringify(result));

  window.location.href = "checkin.html";
});

// Clear the warning message as soon as an answer changes
panasRows.addEventListener("change", function () {
  panasMessage.textContent = "";
});
// Only crew members and leaders (auth_guard.js); also shows the page
requireRole(["crew", "leader"]);
connectLogoutButton();  // from supabase_client.js (no-op without #logout-btn)
