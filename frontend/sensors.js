// ===== ASTRA HEALTH - Sensors page =====
// For now each "Connect" button only shows "Connecting..."
// with a spinning circle for 5 seconds.
// Later, replace the part marked "TODO" with the real connection.

const sensorButtons = document.querySelectorAll(".sensor-btn");

sensorButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    const card = button.parentElement;

    // "Connecting..." text with a small spinning circle
    button.disabled = true;
    button.innerHTML = 'Connecting... <span class="spinner"></span>';
    card.classList.remove("connected");

    // Wait 5 seconds (5000 ms)
    setTimeout(function () {

      // TODO: connect to the real sensor here

      button.disabled = false;
      button.textContent = "Connected ✓";
      card.classList.add("connected");
    }, 5000);
  });
});
// Only crew members and leaders (auth_guard.js); also shows the page
requireRole(["crew", "leader"]);
connectLogoutButton();  // from supabase_client.js (no-op without #logout-btn)
