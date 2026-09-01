// Root bootstrap: application modules live under src while vendor scripts and
// index.html remain directly servable from the repository root.
import { Application } from "./src/app/Application.js";

new Application(document.querySelector("#app")).launch();