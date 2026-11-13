const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const xss = require("xss-clean");
const path = require("path");
const csurf = require("csurf");

// RouteHandler
const authRouter = require("./routes/authRoutes");
const adminAuthRouter = require("./routes/adminAuthRoutes");
const appRouter = require("./routes/appRoutes");
const adminAppRouter = require("./routes/adminAppRoutes");
const adminUsersRouter = require("./routes/adminUsersRoutes");

// Utils
const GlobalErrorHandler = require("./controllers/errorController");

// App Initialization
const app = express();

// Behind a proxy (e.g. Cloudflare Tunnel) every request arrives from the proxy,
// so the rate limiter would see one IP for all users. TRUST_PROXY=1 makes
// Express take the client IP from X-Forwarded-For (one trusted hop).
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
}

// Browser origins allowed to call the API. CORS_ORIGINS (comma-separated)
// replaces the default list, e.g. to add a new dashboard hostname:
// CORS_ORIGINS=https://traffic-signal.quadrumtechnologies.com,https://app.quadrumtechnologies.com
const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "https://traffic-signal.quadrumtechnologies.com",
];
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : DEFAULT_ORIGINS;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Set security HTTP header
app.use(helmet());

// Data sanitization against XSS: malicious html using Javascript
app.use(xss());

// Limit request from the same Ip to the api routes
const limiter = rateLimit({
  max: 500,
  windowMs: 60 * 60 * 1000,
  message: "Too many request from this IP, please try again in an hour!",
});
// app.use(csurf({ cookie: true }));

app.use("/api", limiter);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Body parser from the request. reading data from body into req.body
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

app.get("/", (req, res) => {
  res.status(200).send("HTTP App is running");
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/auth/admin", adminAuthRouter);
app.use("/api/v1/admin/users", adminUsersRouter);
app.use("/api/v1/admin", adminAppRouter);
app.use("/api/v1", appRouter);

// Any request that makes it to this part has lost it's way
app.all("*", (req, res, next) => {
  return res.status(404).json({
    message: `Can't find ${req.originalUrl} on this server!`,
  });
});

// This handles app wide error
app.use(GlobalErrorHandler);

module.exports = app;
