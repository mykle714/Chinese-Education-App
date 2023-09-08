import SettingsListItem from "../components/SettingsComponents/SettingsListItem";
import { SettingsData } from "../components/SettingsComponents/SettingsData";
import "../css/Settings.css";

function Settings() {
  return (
    <div className="Settings">
      <h1 className="SettingsTitle">Settings</h1>
      <ul className="list-group list-group-flush">
        {SettingsData.map((data) => {
          const {type,name,description,labels} = data
          return (<SettingsListItem type={type} name={name} description={description} labels={labels} key={name}/>);
        })}
      </ul>
    </div>
  );
}

export default Settings;
