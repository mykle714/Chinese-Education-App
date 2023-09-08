import { ActivityCardProps } from "../ComponentsTypes";
import {ActivityData} from "../components/LearnComponents/ActivityData";
import "../css/Learn.css"

function Learn() {
  const populateGrid = (cards: ActivityCardProps[]) => {
    return cards.map((v, i) => {
      const {title, description,activityLink,imagePath} = v
      return (
        <div className=" ActivityCardDiv col-1" key={v.title + i}>
          <div className="card">
            <img src={imagePath} className="card-img-top"></img>
            <div className="card-body">
              <h5 className="card-title">{title}</h5>
              <p className="card-text">{description}</p>
              <a href={activityLink} className="btn btn-primary">Go somewhere</a>
            </div>
          </div>
        </div>
      );
    });
  };

  return (
    <div className="Learn">
      <h1 className="LearnTitle">Learn</h1>
      <p className="LearnDescription">
      Lorem ipsum dolor sit amet. In amet nostrum quo deleniti similique qui facere voluptas qui nulla corporis quo dolores minima ad magnam assumenda eos impedit porro. Eos dicta iste qui nisi amet ad veniam quia vel odio quia qui totam illo ad aliquid dolores.

Ea repellat illo qui autem repudiandae et fugit quos qui fuga perferendis ut ipsam animi ea incidunt dicta et quam fugiat! Aut adipisci tempore et quibusdam enim et vero voluptatem qui nostrum dolor sed quae voluptatum est voluptatum incidunt ex mollitia sunt? Ea expedita necessitatibus nam facilis quia aut doloribus laboriosam non nobis expedita et voluptatem dolores eum voluptas quidem non assumenda rerum. Ad dolore consectetur sed quia totam quo corporis fugit.

Et officiis architecto vel expedita nemo hic cupiditate quia aut accusantium fugiat et officia enim est ratione quae. Ut vitae blanditiis ea alias corporis sit eaque nobis qui tempore saepe! Et veniam tempore ut odio unde nam soluta quibusdam sed molestiae molestias. Aut doloremque commodi ab iusto ipsum est voluptatem sint sed autem dolorem.
      </p>

      <div className="divider"></div>

      <div className="container text-center">
          <div className="row row-cols">
            {populateGrid(ActivityData)}
          </div>
        </div>
    </div>
  );
}

export default Learn;
