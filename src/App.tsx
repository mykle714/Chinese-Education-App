import Sidebar from "./components/SidebarComponents/Sidebar";
import ContentViewer from "./components/ContentViewer";
import "./css/App.css";
import "./css/Sidebar.css"
import { useState } from "react";

function App() {
  const [selectedContent, setSelectedContent] = useState("Home");
  return (
    <div className="App">
      <div className="SidebarInApp">
        <Sidebar
          changeContent={(title: string) => {
            setSelectedContent(title);
          }}
        />
      </div>

      <div className="ContentViewerInApp">
        <ContentViewer content={selectedContent}/>
      </div>
    </div>
  );
}

export default App;
