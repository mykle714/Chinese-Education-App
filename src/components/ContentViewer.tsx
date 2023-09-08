import Home from "../ContentViews/Home";
import Account from "../ContentViews/Account";
import Settings from "../ContentViews/Settings";
import Learn from "../ContentViews/Learn";

interface Props {
  content: string
}

function ContentViewer({content}: Props) {
  switch (content) {
    case "Home":
      return <Home/>
    case "Learn":
      return <Learn/>
    case "Account":
      return <Account/>
    case "Settings":
      return <Settings/>
  }
}

export default ContentViewer;
