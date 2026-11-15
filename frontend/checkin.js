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

// ===== Finish button =====
// For now it only checks the PANAS and shows a message.
const finishBtn = document.getElementById("finishBtn");
const finishMessage = document.getElementById("finishMessage");

finishBtn.addEventListener("click", function () {
  if (!panasResult) {
    finishMessage.textContent = "Please complete the mood questionnaire (PANAS) first.";
    finishMessage.className = "finish-message error";
    return;
  }

  finishMessage.textContent = "Mission log completed.";
  finishMessage.className = "finish-message";
});