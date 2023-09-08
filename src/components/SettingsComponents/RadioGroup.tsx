import { RadioGroupProps } from '../../ComponentsTypes'
import "../../css/RadioGroup.css"

function RadioGroup(props: RadioGroupProps) {
    const {groupName,buttonLabels} = props
    const handleRadioChange = (
        name: string,
        event: React.ChangeEvent<HTMLInputElement>
      ) => {
        console.log(name, event);
        /* send update to settings table updater endpoint*/
      }
  return (
    <div>
      <ul className="radioUl">
          {buttonLabels.map((v, i) => {
            return (
              <li className="form-check" key={i}>
                <input
                  className="form-check-input"
                  type="radio"
                  name={groupName}
                  id={`radioButton-${groupName}-${i}`}
                  onChange={(e) => {
                    handleRadioChange(groupName, e);
                  }}
                ></input>
                <label className="form-check-label" htmlFor={`radioButton-${groupName}-${i}`}>{v}</label>
              </li>
            );
          })}
        </ul>
    </div>
  )
}

export default RadioGroup