import {useState} from "react"

interface Props {
  cities: string[]
  heading: string
  onSelectItem: (city: string) => void
}

function ListGroup({cities, heading, onSelectItem}: Props) {
  const [selectedIndex,setSelectedIndex] = useState(-1)

  return (
    <>
      <p>{heading}</p>
      <ul className="list-group">
        {cities.map((city, index) => (
          <li
            className={selectedIndex == index ? "list-group-item active": "list-group-item"}
            key={city}
            onClick={() => {
              setSelectedIndex(index)
              onSelectItem(city)
            }}
          >
            {city}
          </li>
        ))}
      </ul>
    </>
  );
}

export default ListGroup;
