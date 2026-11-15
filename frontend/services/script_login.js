// Page elements
const loginForm = document.getElementById("loginForm");
const astronautIdInput = document.getElementById("astronautId");
const passwordInput = document.getElementById("password");
const showPasswordBtn = document.getElementById("showPasswordBtn");
const helpLink = document.getElementById("helpLink");
const helpBox = document.getElementById("helpBox");
const message = document.getElementById("message");
const loginBtn = document.getElementById("loginBtn");
const userStatusText = document.getElementById("userStatusText");

const EMAIL_DOMAIN = "crew.astra-health.test";

function toEmail(input) {
  const value = input.trim();
  return value.includes("@") ? value : `${value.toLowerCase()}@${EMAIL_DOMAIN}`;
}

function goHome(profile) {
  window.location.href = ROLE_HOME[profile.role] || "index.html";
}

// Show / hide password
showPasswordBtn.addEventListener("click", function () {
  if (passwordInput.type === "password") {
    passwordInput.type = "text";
    showPasswordBtn.textContent = "Hide";
  } else {
    passwordInput.type = "password";
    showPasswordBtn.textContent = "Show";
  }
});

// Show / hide help box
helpLink.addEventListener("click", function (event) {
  event.preventDefault();
  helpBox.classList.toggle("hidden");
});

// Log in
loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  message.textContent = "";

  const id = astronautIdInput.value;
  const password = passwordInput.value;
  if (!id.trim() || !password) {
    message.textContent = "Enter your ID and password.";
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Entering...";

  // 1) Supabase checks the password and saves the session in the browser
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: toEmail(id),
    password: password,
  });

  if (error) {
    console.error("Login error:", error.message);
    message.textContent = "Wrong ID or password.";
    loginBtn.disabled = false;
    loginBtn.innerHTML = "Enter the portal &rarr;";
    return;
  }

  // 2) Read the role (crew / leader / admin) from profiles
  const profile = await getProfile();
  if (!profile) {
    message.textContent = "Your user has no profile. Contact the ground team.";
    await supabaseClient.auth.signOut();
    loginBtn.disabled = false;
    loginBtn.innerHTML = "Enter the portal &rarr;";
    return;
  }

  userStatusText.textContent = `${profile.astronaut_code || profile.name} (${profile.role})`;
  goHome(profile);
});

// If there is already an open session, skip the login
(async function () {
  const profile = await getProfile();
  if (profile) goHome(profile);
})();
