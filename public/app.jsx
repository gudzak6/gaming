const { useCallback, useEffect, useRef, useState } = React;
const APP_CONFIG = window.APP_CONFIG || {};
const API_BASE = APP_CONFIG.API_BASE || "";
const SOCKET_URL = APP_CONFIG.SOCKET_URL || "";

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

function getCountdownParts(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatTimeOfDay(isoString) {
  if (!isoString) return "TBD";
  return new Date(isoString).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function useSocket(token, enabled, onEvents) {
  const socketRef = useRef(null);
  const onEventsRef = useRef(onEvents);

  useEffect(() => {
    onEventsRef.current = onEvents;
  }, [onEvents]);

  useEffect(() => {
    if (!token || !enabled) return;
    const socket = io(SOCKET_URL || undefined, { auth: { token } });
    socketRef.current = socket;
    if (onEventsRef.current) {
      onEventsRef.current(socket);
    }
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, enabled]);

  return socketRef;
}

function AuthScreen({ onAuthed }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("request");
  const [error, setError] = useState("");

  async function requestOtp() {
    setError("");
    const res = await apiFetch("/api/auth/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to request OTP.");
      return;
    }
    setStep("verify");
  }

  async function verifyOtp() {
    setError("");
    const res = await apiFetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, name, otp }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to verify OTP.");
      return;
    }
    onAuthed(data);
  }

  return (
    <div className="container">
      <div className="card">
        <h2>Sign in</h2>
        <p>Enter your phone number and name to get started.</p>
        <input
          className="input"
          placeholder="Phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          className="input"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {step === "verify" && (
          <input
            className="input"
            placeholder="OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
        )}
        {error && <p style={{ color: "#f87171" }}>{error}</p>}
        <div className="row">
          {step === "request" ? (
            <button className="btn" onClick={requestOtp}>
              Send OTP
            </button>
          ) : (
            <button className="btn" onClick={verifyOtp}>
              Verify OTP
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HomeScreen({
  show,
  countdownMs,
  onJoin,
  onViewResults,
  user,
  onLogout,
  onPractice,
  leaderboard,
  players,
}) {
  const hasShow = Boolean(show);
  const { hours, minutes, seconds } = getCountdownParts(countdownMs);
  const waitingCount = players?.length ?? 0;
  const bestScore =
    leaderboard?.find((entry) => entry.user_id === user?.id)?.score || 0;
  const fallbackTopScores = [
    { name: "FlappyMaster", score: 47 },
    { name: "BirdBrain", score: 42 },
    { name: "PipeDreamer", score: 38 },
    { name: "WingIt", score: 28 },
    { name: "You", score: bestScore, isYou: true },
  ];
  const topScores =
    leaderboard && leaderboard.length > 0
      ? leaderboard.slice(0, 5).map((entry) => ({
          name: entry.name,
          score: entry.score,
          isYou: entry.user_id === user?.id,
        }))
      : fallbackTopScores;
  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true"></span>
          <span className="brand-name">LivePlay</span>
        </div>
        <div className="topbar-actions">
          <div className="best-score">Best: {bestScore}</div>
          <button className="btn outline" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="container">
        <section className="hero">
          <h1>
            Play Live. <span>Win Together.</span>
          </h1>
          <p>
            Join your friends for daily mini-game battles. Everyone plays at the
            same time. Highest score wins!
          </p>
        </section>

        <section className="countdown-card">
          <div className="countdown-header">
            <span className="countdown-label">Next Game In</span>
          </div>
          {hasShow ? (
            <>
              <div className="countdown-grid">
                <div className="time-block">
                  <div className="time-value">{pad2(hours)}</div>
                  <div className="time-label">Hours</div>
                </div>
                <div className="time-separator">:</div>
                <div className="time-block">
                  <div className="time-value">{pad2(minutes)}</div>
                  <div className="time-label">Minutes</div>
                </div>
                <div className="time-separator">:</div>
                <div className="time-block">
                  <div className="time-value">{pad2(seconds)}</div>
                  <div className="time-label">Seconds</div>
                </div>
              </div>
              <div className="countdown-meta">
                <span className="meta-item">Flappy Bird</span>
                <span className="meta-item">{waitingCount} waiting</span>
              </div>
              <div className="countdown-actions">
                <button className="btn primary" onClick={onJoin}>
                  Join Game
                </button>
              </div>
            </>
          ) : (
            <p className="muted">No show scheduled.</p>
          )}
        </section>

        <section className="practice">
          <p>Can't wait? Warm up before the big game!</p>
          <button className="btn accent" onClick={onPractice}>
            Practice Now
          </button>
          {onViewResults && (
            <button className="btn ghost" onClick={onViewResults}>
              View last leaderboard
            </button>
          )}
        </section>

        <section className="split">
          <div className="panel">
            <h3>Today's Top Scores</h3>
            <div className="score-list">
              {topScores.map((entry, index) => (
                <div
                  key={`${entry.name}-${index}`}
                  className={`score-row ${entry.isYou ? "you" : ""}`}
                >
                  <div className="score-rank">{index + 1}</div>
                  <div className="score-name">
                    {entry.name} {entry.isYou ? "(You)" : ""}
                  </div>
                  <div className="score-value">{entry.score}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>How It Works</h3>
            <ol className="steps">
              <li>
                <span className="step-number">1</span>
                <div>
                  <strong>Join the Queue</strong>
                  <p>Sign up before the countdown ends.</p>
                </div>
              </li>
              <li>
                <span className="step-number">2</span>
                <div>
                  <strong>Play Live</strong>
                  <p>Everyone starts at the same time.</p>
                </div>
              </li>
              <li>
                <span className="step-number">3</span>
                <div>
                  <strong>Climb the Ranks</strong>
                  <p>Beat your friends and claim glory.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>
      </main>
    </div>
  );
}

function LobbyScreen({
  players,
  state,
  countdownMs,
  onBackHome,
  user,
  onLogout,
  show,
}) {
  return (
    <div className="container">
      <div className="card">
        <h2>Game Room Lobby</h2>
        {user && (
          <p>
            Signed in as {user.name} ({user.phone})
          </p>
        )}
        {user && (
          <button className="btn secondary" onClick={onLogout}>
            Log out
          </button>
        )}
        <p>{players.length} players joined</p>
        <p>Show state: {state}</p>
        <p>Countdown: {formatCountdown(countdownMs)}</p>
        <p>Starts at: {formatTimeOfDay(show?.start_time)}</p>
        {state === "scheduled" && (
          <div className="row">
            <button className="btn secondary" onClick={onBackHome}>
              Back to Home
            </button>
          </div>
        )}
      </div>
      <div className="card">
        <h3>Game Preview</h3>
        <GameCanvas onGameOver={() => {}} isActive={false} />
      </div>
      <div className="players">
        {players.map((player) => (
          <div className="player-card" key={player.user_id}>
            <strong>{player.name}</strong>
            <div className="status-pill">{player.status}</div>
            <div>Score: {player.score || 0}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Leaderboard({ leaderboard, currentUserId }) {
  return (
    <table className="leaderboard">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Player</th>
          <th>Score</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {leaderboard.map((entry, index) => (
          <tr
            key={entry.user_id}
            className={entry.user_id === currentUserId ? "highlight" : ""}
          >
            <td>{index + 1}</td>
            <td>{entry.name}</td>
            <td>{entry.score}</td>
            <td>{entry.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GameCanvas({ onGameOver, isActive, onScoreChange }) {
  const canvasRef = useRef(null);
  const [score, setScore] = useState(0);
  const onGameOverRef = useRef(onGameOver);
  const onScoreChangeRef = useRef(onScoreChange);

  useEffect(() => {
    onGameOverRef.current = onGameOver;
  }, [onGameOver]);

  useEffect(() => {
    onScoreChangeRef.current = onScoreChange;
  }, [onScoreChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    if (!isActive) {
      setScore(0);
      if (onScoreChangeRef.current) {
        onScoreChangeRef.current(0);
      }
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.arc(width * 0.25, height / 2, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#94a3b8";
      ctx.font = "16px system-ui";
      ctx.fillText("Get ready to flap...", 90, height / 2 + 50);
      return;
    }
    const gravity = 0.4;
    const flap = -6.5;
    let velocity = 0;
    let birdY = height / 2;
    const birdX = width * 0.25;
    let alive = true;
    let pipes = [];
    let lastSpawn = 0;
    let localScore = 0;
    let startTime = Date.now();
    let animationId;

    function spawnPipe() {
      const gap = 140;
      const pipeWidth = 60;
      const topHeight = 50 + Math.random() * (height - gap - 100);
      pipes.push({
        x: width,
        topHeight,
        width: pipeWidth,
        passed: false,
        gap,
      });
    }

    function flapBird() {
      if (!alive) return;
      velocity = flap;
    }

    function checkCollision(pipe) {
      const birdRadius = 14;
      const withinX = birdX + birdRadius > pipe.x &&
        birdX - birdRadius < pipe.x + pipe.width;
      const hitsTop = birdY - birdRadius < pipe.topHeight;
      const hitsBottom = birdY + birdRadius > pipe.topHeight + pipe.gap;
      return withinX && (hitsTop || hitsBottom);
    }

    function update(time) {
      const elapsed = time - lastSpawn;
      if (elapsed > 1400) {
        spawnPipe();
        lastSpawn = time;
      }

      velocity += gravity;
      birdY += velocity;

      pipes.forEach((pipe) => {
        pipe.x -= 2.5;
        if (!pipe.passed && pipe.x + pipe.width < birdX) {
          pipe.passed = true;
          localScore += 1;
          setScore(localScore);
          if (onScoreChangeRef.current) {
            onScoreChangeRef.current(localScore);
          }
        }
        if (checkCollision(pipe)) {
          alive = false;
        }
      });

      pipes = pipes.filter((pipe) => pipe.x + pipe.width > 0);

      if (birdY < 0 || birdY > height) {
        alive = false;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.arc(birdX, birdY, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#22c55e";
      pipes.forEach((pipe) => {
        ctx.fillRect(pipe.x, 0, pipe.width, pipe.topHeight);
        ctx.fillRect(
          pipe.x,
          pipe.topHeight + pipe.gap,
          pipe.width,
          height - pipe.topHeight - pipe.gap
        );
      });

      if (!alive) {
        const timeAliveMs = Date.now() - startTime;
        onGameOverRef.current({
          score: localScore,
          pipesPassed: localScore,
          timeAliveMs,
        });
        return;
      }
      animationId = requestAnimationFrame(update);
    }

    function handleKey(event) {
      if (event.code === "Space") {
        event.preventDefault();
        flapBird();
      }
    }

    canvas.addEventListener("pointerdown", flapBird);
    window.addEventListener("keydown", handleKey);
    animationId = requestAnimationFrame(update);

    return () => {
      canvas.removeEventListener("pointerdown", flapBird);
      window.removeEventListener("keydown", handleKey);
      cancelAnimationFrame(animationId);
    };
  }, [isActive]);

  return (
    <div className="game-wrapper">
      <div>
        <h3>Score: {score}</h3>
        <canvas ref={canvasRef} width="360" height="520"></canvas>
      </div>
    </div>
  );
}

function App() {
  const [auth, setAuth] = useState(null);
  const [show, setShow] = useState(null);
  const [countdownMs, setCountdownMs] = useState(0);
  const [players, setPlayers] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [view, setView] = useState("home");
  const [state, setState] = useState("scheduled");
  const [gameOver, setGameOver] = useState(false);
  const [gamePhase, setGamePhase] = useState("ready");
  const [startCountdownMs, setStartCountdownMs] = useState(10000);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [localScore, setLocalScore] = useState(0);
  const submittedScoreRef = useRef(false);
  const gameOverRef = useRef(false);
  const pendingJoinRef = useRef(null);
  const [resultsShowId, setResultsShowId] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [socketWanted, setSocketWanted] = useState(false);
  const [lastResultsShowId, setLastResultsShowId] = useState(
    localStorage.getItem("lastResultsShowId")
  );

  const token = auth?.token || localStorage.getItem("token");
  const socketEnabled =
    Boolean(token) && (socketWanted || view !== "home" || state !== "scheduled");

  const applyShowState = useCallback((nextState, showId) => {
    setState(nextState);
    if (nextState === "playing" && !gameOverRef.current) {
      setView("playing");
    }
    if (nextState === "results") {
      setResultsShowId(showId);
      setLastResultsShowId(showId);
      localStorage.setItem("lastResultsShowId", showId);
      setView("results");
    }
    if (nextState === "scheduled") setView("home");
  }, []);

  const socketRef = useSocket(token, socketEnabled, (socket) => {
    socket.on("connect", () => {
      if (pendingJoinRef.current) {
        socket.emit("room:join", { showId: pendingJoinRef.current });
        pendingJoinRef.current = null;
      }
    });
    socket.on("show:tick", (payload) => {
      const nextStart = new Date(payload.startTime).toISOString();
      setShow((prev) => {
        if (!prev || prev.id !== payload.showId) {
          return {
            id: payload.showId,
            start_time: nextStart,
            state: payload.state,
          };
        }
        if (prev.start_time !== nextStart || prev.state !== payload.state) {
          return { ...prev, start_time: nextStart, state: payload.state };
        }
        return prev;
      });
      setCountdownMs(payload.remainingMs);
      if (typeof payload.serverTime === "number") {
        setServerOffsetMs(payload.serverTime - Date.now());
      }
      applyShowState(payload.state, payload.showId);
    });
    socket.on("show:state_change", (payload) => {
      setShow((prev) =>
        prev
          ? { ...prev, id: payload.showId, state: payload.state }
          : prev
      );
      applyShowState(payload.state, payload.showId);
    });
    socket.on("room:presence_update", (payload) => {
      setPlayers(payload.players || []);
    });
    socket.on("leaderboard:update", (payload) => {
      setLeaderboard(payload.leaderboard || []);
    });
    socket.on("results:final", (payload) => {
      setLeaderboard(payload.leaderboard || []);
      setView("results");
    });
  });

  useEffect(() => {
    apiFetch("/api/show/next")
      .then((res) => res.json())
      .then((data) => {
        setShow(data.show);
        const now = data.serverTime || Date.now();
        const start = new Date(data.show.start_time).getTime();
        setCountdownMs(Math.max(0, start - now));
        applyShowState(data.show.state, data.show.id);
        setServerOffsetMs(now - Date.now());
      });
  }, [applyShowState]);

  useEffect(() => {
    if (socketEnabled) return;
    let isActive = true;
    const pollShow = () => {
      apiFetch("/api/show/next")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!isActive || !data?.show) return;
          setShow(data.show);
          const now = data.serverTime || Date.now();
          const start = new Date(data.show.start_time).getTime();
          setCountdownMs(Math.max(0, start - now));
          applyShowState(data.show.state, data.show.id);
          setServerOffsetMs(now - Date.now());
        })
        .catch(() => {});
    };
    pollShow();
    const interval = setInterval(pollShow, 15000);
    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [applyShowState, socketEnabled]);

  useEffect(() => {
    if (window.location.hash === "#leaderboard" && lastResultsShowId) {
      setResultsShowId(lastResultsShowId);
      setView("results");
    }
  }, [lastResultsShowId]);

  useEffect(() => {
    if (!show) return;
    const interval = setInterval(() => {
      const now = Date.now() + serverOffsetMs;
      const start = new Date(show.start_time).getTime();
      setCountdownMs(Math.max(0, start - now));
    }, 1000);
    return () => clearInterval(interval);
  }, [show, serverOffsetMs]);

  useEffect(() => {
    if (view !== "playing") return;
    setGameOver(false);
    setGamePhase("ready");
    setStartCountdownMs(10000);
    submittedScoreRef.current = false;
    gameOverRef.current = false;
    setResultsShowId(null);
    setLocalScore(0);
  }, [view, show?.id]);

  useEffect(() => {
    gameOverRef.current = gameOver;
  }, [gameOver]);

  useEffect(() => {
    if (gamePhase !== "countdown") return;
    const interval = setInterval(() => {
      setStartCountdownMs((prev) => {
        const next = Math.max(0, prev - 1000);
        if (next === 0) {
          setGamePhase("active");
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gamePhase]);

  useEffect(() => {
    if (!auth?.token) return;
    localStorage.setItem("token", auth.token);
    if (auth.user) {
      setUserProfile(auth.user);
    }
  }, [auth]);

  useEffect(() => {
    if (!token || userProfile) return;
    apiFetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.id) {
          setUserProfile(data);
          setAuth((prev) => (prev ? { ...prev, user: data } : { user: data }));
        }
      })
      .catch(() => {});
  }, [token, userProfile]);

  useEffect(() => {
    if (view !== "results" || !resultsShowId) return;
    apiFetch(`/api/show/${resultsShowId}/leaderboard`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.leaderboard)) {
          setLeaderboard(data.leaderboard);
        }
      })
      .catch(() => {});
  }, [view, resultsShowId]);

  useEffect(() => {
    if (view === "results") {
      window.location.hash = "leaderboard";
    } else if (window.location.hash === "#leaderboard") {
      history.replaceState(null, "", window.location.pathname);
    }
  }, [view]);

  const joinRoom = (overrideShow = null, overrideState = null) => {
    const activeShow = overrideShow || show;
    const activeState = overrideState || state;
    if (!activeShow) return;
    if (!socketRef.current) {
      setSocketWanted(true);
      pendingJoinRef.current = activeShow.id;
    } else if (socketRef.current.connected) {
      socketRef.current.emit("room:join", { showId: activeShow.id });
    } else {
      pendingJoinRef.current = activeShow.id;
    }
    if (activeState === "playing") {
      setView("playing");
    } else if (activeState === "results") {
      setView("results");
    } else if (activeState === "scheduled") {
      setView("home");
    } else {
      setView("lobby");
    }
  };

  const logoutUser = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      // ignore
    }
    localStorage.removeItem("token");
    setAuth(null);
    setUserProfile(null);
    setSocketWanted(false);
    setView("home");
  };

  const startShowNow = async () => {
    const adminToken = localStorage.getItem("adminToken");
    if (!adminToken) return;
    const res = await apiFetch("/api/admin/show/now", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    if (!res.ok || !data.show) return;
    setShow(data.show);
    setState(data.show.state);
    setCountdownMs(0);
    joinRoom(data.show, data.show.state);
  };

  const submitScore = (stats) => {
    if (!socketRef.current) return;
    if (gameOver || submittedScoreRef.current) return;
    submittedScoreRef.current = true;
    setGameOver(true);
    if (show?.id) {
      setResultsShowId(show.id);
      setLastResultsShowId(show.id);
      localStorage.setItem("lastResultsShowId", show.id);
    }
    setView("results");
    socketRef.current.emit("game:submit_score", stats, (ack) => {
      if (!ack?.ok) {
        submittedScoreRef.current = false;
      }
    });
  };

  const startLocalGame = () => {
    if (gamePhase === "ready") {
      setGamePhase("countdown");
      setStartCountdownMs(10000);
    }
  };

  if (!token) {
    return <AuthScreen onAuthed={setAuth} />;
  }

  if (!show) {
    return (
      <div className="container">
        <div className="card">Loading show...</div>
      </div>
    );
  }

  if (view === "home") {
    return (
      <HomeScreen
        show={show}
        countdownMs={countdownMs}
        onJoin={joinRoom}
        onPractice={() => {
          setView("playing");
          setSocketWanted(false);
        }}
        onViewResults={
          lastResultsShowId
            ? () => {
                setResultsShowId(lastResultsShowId);
                setView("results");
              }
            : null
        }
        user={userProfile}
        onLogout={logoutUser}
        leaderboard={leaderboard}
        players={players}
      />
    );
  }

  if (view === "lobby") {
    return (
      <LobbyScreen
        players={players}
        state={state}
        countdownMs={countdownMs}
        onBackHome={() => {
          setView("home");
          setSocketWanted(false);
        }}
        user={userProfile}
        onLogout={logoutUser}
        show={show}
      />
    );
  }

  if (view === "playing") {
    return (
      <div className="game-page">
        <div className="game-topbar">
          <button
            className="back-link"
            onClick={() => {
              setView("lobby");
            }}
          >
            ← Back to Lobby
          </button>
        </div>
        <div className="game-score">Score: {localScore}</div>
        <div className="game-canvas-card">
          <GameCanvas
            onGameOver={submitScore}
            isActive={gamePhase === "active"}
            onScoreChange={setLocalScore}
          />
        </div>
        <div className="game-footer">
          {gamePhase === "ready" && (
            <>
              <p>Tap or press space to start playing!</p>
              <button className="btn primary" onClick={startLocalGame}>
                Start game
              </button>
            </>
          )}
          {gamePhase === "countdown" && (
            <p>Starting in {formatCountdown(startCountdownMs)}</p>
          )}
          {gameOver && <p>You are out. Waiting for results...</p>}
        </div>
      </div>
    );
  }

  if (view === "results") {
    return (
      <div className="container">
        <div className="card">
          <h2>Leaderboard</h2>
          {userProfile && (
            <p>
              Signed in as {userProfile.name} ({userProfile.phone})
            </p>
          )}
          <Leaderboard
            leaderboard={leaderboard}
            currentUserId={auth?.user?.id}
          />
        </div>
        <div className="card">
          <p>Thanks for playing. Next show soon.</p>
          <button
            className="btn secondary"
            onClick={() => {
              setView("home");
              setSocketWanted(false);
            }}
          >
            Back to Homepage
          </button>
          <button className="btn secondary" onClick={logoutUser}>
            Log out
          </button>
        </div>
      </div>
    );
  }

  return null;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
