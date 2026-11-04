import { Navigate, Route, Routes } from "react-router-dom";
import { NewSaveProvider } from "./features/newSave/NewSaveContext";
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
    <NewSaveProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="saves" element={<Saves />} />
          <Route path="saves/:id" element={<Review />} />
          <Route path="progress" element={<Progress />} />
          <Route path="settings" element={<Settings />} />
          <Route path="ui" element={<UiKit />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </NewSaveProvider>
  );
}
