import { render } from "preact";
import { Router } from "wouter-preact";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("app");
if (root) {
  render(
    <Router>
      <App />
    </Router>,
    root,
  );
}
