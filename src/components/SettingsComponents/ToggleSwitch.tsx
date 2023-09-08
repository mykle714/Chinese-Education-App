import { ToggleSwitchProps } from '../../ComponentsTypes';
import "../../css/ToggleSwitch.css"

function ToggleSwitch(props: ToggleSwitchProps) {
    const {name} = props

    function handleToggleChange(
        name: string,
        event: React.ChangeEvent<HTMLInputElement>
      ) {
        const checked = event.target.checked as boolean;
        console.log(name, checked);
        /* send update to settings table updater endpoint*/
      }
  return (
    <div className="form-check form-switch settingsToggle">
        <input
          className="form-check-input"
          type="checkbox"
          role="switch"
          id="flexSwitchCheckDefault"
          aria-label={name}
          onChange={(e) => {
            handleToggleChange(name, e);
          }}
        ></input>
      </div>
  )
}

export default ToggleSwitch