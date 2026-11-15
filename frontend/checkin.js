// ===== ASTRA HEALTH - Check-in page =====

// ===== Measurement buttons (HR, HRV, SpO2, Temperature) =====
// For now they only show a spinning circle for 5 seconds.
// Later, replace the part marked "TODO" with the real function.

const measureButtons = document.querySelectorAll(".measure-btn");

measureButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    const sensor = button.dataset.sensor;
    const status = button.parentElement.querySelector(".measure-status");

    // "Connecting..." text with a small spinning circle instead of a number
    button.disabled = true;
    button.innerHTML = 'Connecting... <span class="spinner"></span>';
    status.textContent = "Connecting to " + sensor + " sensor";
    status.classList.remove("done");

    // Wait 5 seconds (5000 ms)
    setTimeout(function () {

      // TODO: call the real measurement function here

      button.disabled = false;
      button.textContent = "Measure again";
      status.textContent = "Sensor connected ✓";
      status.classList.add("done");
    }, 5000);
  });
});

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

// ===== Finish button =====
// For now it only checks the PANAS and shows a message.
const finishBtn = document.getElementById("finishBtn");
const finishMessage = document.getElementById("finishMessage");

finishBtn.addEventListener("click", function () {
  const answered = calculatePanas();

  if (answered < panasItems.length) {
    finishMessage.textContent = "Please answer all 20 PANAS items (" + answered + "/20 answered).";
    finishMessage.className = "finish-message error";
    return;
  }

  finishMessage.textContent = "Mission log completed.";
  finishMessage.className = "finish-message";
});