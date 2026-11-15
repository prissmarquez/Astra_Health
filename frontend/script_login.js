

//Page elements
const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("password");
const showPasswordBtn = document.getElementById("showPasswordBtn");
const helpLink = document.getElementById("helpLink");
const helpBox = document.getElementById("helpBox");

//Show / hide password
showPasswordBtn.addEventListener("click", function () {
  if (passwordInput.type === "password") {
    passwordInput.type = "text";
    showPasswordBtn.textContent = "Hide";
  } else {
    passwordInput.type = "password";
    showPasswordBtn.textContent = "Show";
  }
});

//Show / hide help box
helpLink.addEventListener("click", function (event) {
  event.preventDefault();
  helpBox.classList.toggle("hidden");
});

loginForm.addEventListener("submit", function (event) {
  event.preventDefault();
});