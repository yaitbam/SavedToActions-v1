import { Navigate, Route, Routes } from "react-router-dom";
import { SessionRoutes, RequireWorkspace } from "./features/auth/SessionRoutes";
import { Login } from "./pages/Login";
import { CompleteProfile } from "./pages/CompleteProfile";
import { Privacy } from "./pages/Privacy";
import { AppShell } from "./layout/AppShell";
import { Home } from "./pages/Home";
import { Landing } from "./pages/Landing";
import { Progress } from "./pages/Progress";
import { Review } from "./pages/Review";
import { Saves } from "./pages/Saves";
import { Settings } from "./pages/Settings";
import { UiKit } from "./pages/UiKit";

export default function App() {
  return (
    <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route element={<SessionRoutes />}>
        <Route path="/login" element={<Login />} />
        <Route path="/complete-profile" element={<CompleteProfile />} />
        <Route element={<RequireWorkspace />}>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="saves" element={<Saves />} />
          <Route path="saves/:id" element={<Review />} />
          <Route path="progress" element={<Progress />} />
          <Route path="settings" element={<Settings />} />
          <Route path="ui" element={<UiKit />} />
        </Route>
        </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
