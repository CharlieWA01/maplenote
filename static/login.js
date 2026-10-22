// The sign-in page. It sends the same form a plain HTML form would (the
// server's POST /login reads `password`), but from a script, so it can add the
// body's hash that CloudFront needs in production (see body-hash.js). Without
// scripts the form still works on its own, wherever there's no CloudFront.
const form = document.querySelector("form.login");

function showError(message) {
  let error = form.querySelector(".login-error");
  if (!error) {
    error = document.createElement("p");
    error.className = "login-error";
    form.querySelector("button").before(error);
  }
  error.textContent = message;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = new URLSearchParams(new FormData(form)).toString();
  let response;
  try {
    response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...(await bodyHashHeaders(body)) },
      body,
      // A right password answers with a redirect to the editor (and the cookies);
      // don't follow it here, go there for real.
      redirect: "manual",
    });
  } catch {
    return showError("Couldn't reach Maplenote. Check your connection and try again.");
  }
  if (response.type === "opaqueredirect") {
    location.href = "/";
  } else {
    showError(response.status === 401 ? "That password isn't right." : `Sign-in failed (${response.status}).`);
    form.password.select();
  }
});
