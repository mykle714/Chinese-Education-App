import { SettingsListItemProps } from "../../ComponentsTypes";
import "../../css/Settings.css"
import ToggleSwitch from "./ToggleSwitch";
import RadioGroup from "./RadioGroup";

function SettingsListItem(props: SettingsListItemProps) {
  const {type, name, description, labels} = props

  const renderControls = (type: string) => {
    switch (type) {
      case "toggle":
        return <ToggleSwitch name={name}/>;
      case "radio":
        return <RadioGroup groupName={name} buttonLabels={labels ?? []}/>;
    }
  };


  return (
    <li className="list-group-item" key={name}>
      <h2>{name}</h2>
      <div className="SettingsLiBody">
        <p className="Description">{description}</p>
        {renderControls(type)}
      </div>
    </li>
  );
}

export default SettingsListItem;
