// ===== ASTRA HEALTH - Check-in page =====

// ===== Measurement buttons (HR, HRV, SpO2, Temperature) =====
// For now they only show a spinning circle for 5 seconds.
// Later, replace the part marked "TODO" with the real function.

const measureButtons = document.querySelectorAll(".measure-btn");

measureButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    const status = button.parentElement.querySelector(".measure-status");

    // "Connecting..." text with a small spinning circle instead of a number
    button.disabled = true;
    button.innerHTML = 'Connecting... <span class="spinner"></span>';
    status.textContent = "Connecting to sensor";
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

// ===== PANAS card =====
// Shows if the questionnaire was already completed (saved by panas.js)
const panasState = document.getElementById("panasState");
const panasBtn = document.getElementById("panasBtn");
const panasResult = JSON.parse(sessionStorage.getItem("panasResult"));

if (panasResult) {
  panasState.textContent = "Completed ✓  Positive: " + panasResult.positive +
                           "/50 · Negative: " + panasResult.negative + "/50";
  panasState.classList.add("done");
  panasBtn.textContent = "Answer again →";
}

// ===== Sleep: convert hours + minutes to sleep_min =====
// Returns null if both fields are empty.
function getSleepMinutes() {
  const hours = document.getElementById("sleepHours").value;
  const minutes = document.getElementById("sleepMinutes").value;

  if (hours === "" && minutes === "") {
    return null;
  }

  return Number(hours) * 60 + Number(minutes);
}

// ===== Data to send to the backend =====
// Uses the same names as the database.
// The sensor values are null for now; they will come from the real sensors.
function getCheckinData() {
  const exercise = document.querySelector('input[name="exercise"]:checked');

  return {
    heart_rate: null,
    hrv: null,              // confirm this name with backend
    spo2: null,
    temperature: null,
    systolic_bp: null,      // blood pressure is sent as two values
    diastolic_bp: null,
    glucose: null,
    sleep_min: getSleepMinutes(),
    context: document.getElementById("sleepNotes").value.trim(),
    exercise: exercise ? exercise.value : null,
    panas_positive: panasResult ? panasResult.positive : null,
    panas_negative: panasResult ? panasResult.negative : null
  };
}

// ===== Finish button =====
// For now it checks the form and shows the data in the console (F12).
const finishBtn = document.getElementById("finishBtn");
const finishMessage = document.getElementById("finishMessage");

function showFinishError(text) {
  finishMessage.textContent = text;
  finishMessage.className = "finish-message error";
}

finishBtn.addEventListener("click", function () {
  const minutes = document.getElementById("sleepMinutes").value;
  const sleepMin = getSleepMinutes();

  if (minutes !== "" && (Number(minutes) < 0 || Number(minutes) > 59)) {
    showFinishError("Sleep minutes must be between 0 and 59.");
    return;
  }

  if (sleepMin !== null && (sleepMin < 0 || sleepMin > 1440)) {
    showFinishError("Sleep time must be between 0 and 24 hours.");
    return;
  }

  if (!panasResult) {
    showFinishError("Please complete the mood questionnaire (PANAS) first.");
    return;
  }

  // TODO: send this object to the backend (PHP)
  console.log(getCheckinData());

  finishMessage.textContent = "Mission log completed.";
  finishMessage.className = "finish-message";
});