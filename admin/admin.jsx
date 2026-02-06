const { useEffect, useState } = React;
const APP_CONFIG = window.APP_CONFIG || {};
const API_BASE = APP_CONFIG.API_BASE || "";

function apiFetch(path, options) {
  return fetch(`${API_BASE}${path}`, options);
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}`;
}

function formatTimeOfDay(isoString) {
  if (!isoString) return "TBD";
  return new Date(isoString).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function AdminApp() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("adminToken"));
  const [error, setError] = useState("");
  const [status, setStatus] = useState("idle");
  const [show, setShow] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [startClock, setStartClock] = useState("");
  const [countdownMs, setCountdownMs] = useState(0);

  const headers = token
    ? {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      }
    : { "Content-Type": "application/json" };

  async function login() {
    setError("");
    const res = await apiFetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Login failed.");
      return;
    }
    localStorage.setItem("adminToken", data.token);
    setToken(data.token);
  }

  function logout() {
    localStorage.removeItem("adminToken");
    setToken(null);
    setShow(null);
    setPassword("");
  }

  async function startNow() {
    if (!token) return;
    setStatus("starting");
    const res = await apiFetch("/api/admin/show/now", {
      method: "POST",
      headers,
    });
    const data = await res.json();
    setStatus("idle");
    if (!res.ok) {
      setError(data.error || "Failed to start show.");
      return;
    }
    setShow(data.show);
    setError("");
  }

  async function cancelShow() {
    if (!token) return;
    setStatus("cancelling");
    const res = await apiFetch("/api/admin/show/cancel", {
      method: "POST",
      headers,
    });
    setStatus("idle");
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to cancel show.");
      return;
    }
    setError("");
  }

  async function scheduleShow() {
    if (!token || !startDate || !startClock) return;
    const combined = new Date(`${startDate}T${startClock}`);
    if (Number.isNaN(combined.getTime())) {
      setError("Please select a valid date and time.");
      return;
    }
    setStatus("scheduling");
    const res = await apiFetch("/api/admin/show/schedule", {
      method: "POST",
      headers,
      body: JSON.stringify({ startTime: combined.toISOString() }),
    });
    const data = await res.json();
    setStatus("idle");
    if (!res.ok) {
      setError(data.error || "Failed to schedule show.");
      return;
    }
    setShow(data.show);
    setError("");
  }

  useEffect(() => {
    if (!token) return;
    let isMounted = true;
    const fetchShow = () =>
      apiFetch("/api/show/next")
        .then((res) => res.json())
        .then((data) => {
          if (isMounted) setShow(data.show);
        })
        .catch(() => {});
    fetchShow();
    const interval = setInterval(fetchShow, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [token]);

  useEffect(() => {
    if (!show?.start_time) return;
    const interval = setInterval(() => {
      const start = new Date(show.start_time).getTime();
      setCountdownMs(Math.max(0, start - Date.now()));
    }, 1000);
    return () => clearInterval(interval);
  }, [show?.start_time]);

  if (!token) {
    return (
      <div className="container">
        <div className="card">
          <h2>Admin Login</h2>
          <input
            className="input"
            placeholder="Admin password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p style={{ color: "#f87171" }}>{error}</p>}
          <button className="btn" onClick={login}>
            Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h2>Live Show Controls</h2>
        {show ? (
          <p>
            Current show:{" "}
            <strong>{new Date(show.start_time).toLocaleString()}</strong>
          </p>
        ) : (
          <p>No show loaded.</p>
        )}
        <button className="btn secondary" onClick={logout}>
          Log out
        </button>
      </div>

      <div className="card">
        <h3>Start a show now</h3>
        <p>
          {status === "starting"
            ? "Show will start now."
            : `State: ${show?.state || "unknown"}`}
        </p>
        <p>Starts in: {formatCountdown(countdownMs)}</p>
        <p>Starts at: {formatTimeOfDay(show?.start_time)}</p>
        <button className="btn" onClick={startNow} disabled={status !== "idle"}>
          Start now
        </button>
        <button
          className="btn secondary"
          onClick={cancelShow}
          disabled={status !== "idle"}
        >
          Cancel show
        </button>
      </div>

      <div className="card">
        <h3>Schedule a show</h3>
        <p>Select date and time</p>
        <div className="row">
          <input
            className="input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <input
            className="input"
            type="time"
            value={startClock}
            onChange={(e) => setStartClock(e.target.value)}
          />
        </div>
        <button
          className="btn secondary"
          onClick={scheduleShow}
          disabled={status !== "idle"}
        >
          Schedule show
        </button>
        {error && <p style={{ color: "#f87171" }}>{error}</p>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<AdminApp />);
