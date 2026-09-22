import CausalStudioApp from "../components/CausalStudioApp.jsx";

import { StudyProvider } from "../components/study/StudyProvider.jsx";

export function App() {
  return <StudyProvider><CausalStudioApp /></StudyProvider>;
}
