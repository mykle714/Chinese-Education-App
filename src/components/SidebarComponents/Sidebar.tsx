import { useState } from "react";
import "../../css/Sidebar.css";
import { SidebarData } from "./SidebarData";

interface Props {
  changeContent: (content: string) => void
}

function Sidebar({changeContent}: Props) {
  const [selection, setSelection] = useState(0);

  const onSidebarClick = (title: string, index: number) => {
    changeContent(title)
    setSelection(index);
    console.log(title)
  };

  const createSidebarButtons = SidebarData.map((val, index) => {
    return (
      <li
        key={index}
        id={selection == index ? "selected" : "notSelected"}
        onClick={() => {
          onSidebarClick(val.title, index);
        }}
      >
        <span className="SideBarSelected"></span>
        <span className="SideBarIcon">{val.icon}</span>
        <span className="SideBarText">{val.title}</span>
      </li>
    );
  });

  return (
    <div className="Sidebar">
      <ul className="SidebarUL">{createSidebarButtons}</ul>
    </div>
  );
}

export default Sidebar;
