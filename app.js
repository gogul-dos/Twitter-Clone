// app.js

const express = require("express");
const { open } = require("sqlite");
const path = require("path");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

let db = null;
const databasePath = path.join(__dirname, "twitterClone.db");
const app = express();
app.use(express.json());

const initializer = async () => {
  try {
    db = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("http://localhost:3000/ is Running...");
    });
  } catch (e) {
    console.log(`DB Error: '${e.message}'`);
  }
};
initializer();

// API 1: User registration
app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const selectQuery = `SELECT * FROM user WHERE username = "${username}" ;`;
  const selectResult = await db.all(selectQuery);

  if (selectResult.length > 0) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 12);
      const insertQuery = `
            INSERT INTO user(username,password,name,gender) VALUES
            ("${username}","${hashedPassword}","${name}","${gender}");`;
      await db.run(insertQuery);
      response.send("User created successfully");
    }
  }
});

// API 2: User login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectQuery = `SELECT * FROM user WHERE username = "${username}";`;
  const selectResult = await db.get(selectQuery);

  if (!selectResult) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      selectResult.password
    );
    if (isPasswordMatched) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// Authentication middleware
const authenticate = async (request, response, next) => {
  const authHead = request.headers["authorization"];
  if (!authHead) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    const jwtToken = authHead.split(" ")[1];
    if (!jwtToken) {
      response.status(401);
      response.send("Invalid JWT Token");
    } else {
      jwt.verify(jwtToken, "MY_SECRET", async (error, payload) => {
        if (error) {
          response.status(401);
          response.send("Invalid JWT Token");
        } else {
          request.body.username = payload.username;
          next();
        }
      });
    }
  }
};

// API 3: Get user's tweets feed
app.get("/user/tweets/feed/", authenticate, async (request, response) => {
  const { username } = request.body;
  const userIdQuery = `SELECT user_id FROM user WHERE username = "${username}";`;
  const userIdResult = await db.get(userIdQuery);
  const followerId = userIdResult.user_id;

  const selectQuery = `
    SELECT user.username AS username, tweet.tweet AS tweet, tweet.date_time AS dateTime
    FROM (user NATURAL JOIN tweet) AS T1
    LEFT JOIN follower ON T1.user_id = follower.following_user_id
    WHERE follower_user_id = '${followerId}' ORDER BY date_time DESC LIMIT 4;`;

  const selectResult = await db.all(selectQuery);
  response.send(selectResult);
});

// API 4: Get user's following list
app.get("/user/following/", authenticate, async (request, response) => {
  const { username } = request.body;
  const userIdQuery = `SELECT user_id FROM user WHERE username = "${username}";`;
  const userIdResult = await db.get(userIdQuery);
  const userId = userIdResult.user_id;

  const selectQuery = `
    SELECT name FROM user
    LEFT JOIN follower ON user.user_id = follower.following_user_id 
    WHERE follower_user_id =  '${userId}';`;

  const selectResult = await db.all(selectQuery);
  response.send(selectResult);
});

// API 5: Get user's followers list
app.get("/user/followers/", authenticate, async (request, response) => {
  const { username } = request.body;
  const userIdQuery = `SELECT user_id FROM user WHERE username = "${username}";`;
  const userIdResult = await db.get(userIdQuery);
  const userId = userIdResult.user_id;

  const selectQuery = `
    SELECT name FROM user
    LEFT JOIN follower ON user.user_id = follower.follower_user_id 
    WHERE following_user_id =  '${userId}';`;

  const selectResult = await db.all(selectQuery);
  response.send(selectResult);
});

// API 6: Get tweet details
app.get("/tweets/:tweetId/", authenticate, async (request, response) => {
  const { username } = request.body;
  const { tweetId } = request.params;
  const userIdQuery = `SELECT user_id FROM user WHERE username = "${username}";`;
  const userIdResult = await db.get(userIdQuery);
  const userId = userIdResult.user_id;

  const selectQuery = `
    SELECT
      T.tweet AS tweet,
      COUNT(L.like_id) AS likes,
      COUNT(R.reply_id) AS replies,
      T.date_time AS dateTime
    FROM
      tweet AS T
      LEFT JOIN like AS L ON T.tweet_id = L.tweet_id
      LEFT JOIN reply AS R ON T.tweet_id = R.tweet_id
      JOIN follower AS F ON T.user_id = F.following_user_id
    WHERE
      F.follower_user_id = "${userId}" AND tweet_id = '${tweetId}'
    GROUP BY
      T.tweet_id
    ORDER BY
      T.date_time DESC;
  `;

  const selectResult = await db.all(selectQuery);

  if (selectResult.length >= 1) {
    // Send tweet details
    response.send({
      tweet: selectResult[0].tweet,
      likes: selectResult[0].likes,
      replies: selectResult[0].replies,
      dateTime: selectResult[0].dateTime,
    });
  } else {
    // Invalid Request
    response.status(401);
    response.send("Invalid Request");
  }
});

/// API 7: Get likes for a tweet
app.get("/tweets/:tweetId/likes/", authenticate, async (request, response) => {
  const { username } = request.body;
  const { tweetId } = request.params;
  const userIdQuery = `SELECT user_id FROM user WHERE username = "${username}";`;
  const userIdResult = await db.get(userIdQuery);
  const userId = userIdResult.user_id;

  // Check if the user is following the author of the tweet
  const checkFollowingQuery = `
    SELECT *
    FROM tweet AS T
    JOIN follower AS F ON T.user_id = F.following_user_id
    WHERE T.tweet_id = '${tweetId}' AND F.follower_user_id = '${userId}';
  `;

  const isFollowing = await db.all(checkFollowingQuery);

  if (isFollowing.length > 0) {
    // User is following, fetch likes
    const likesQuery = `
      SELECT user.username AS username
      FROM like
      JOIN user ON like.user_id = user.user_id
      WHERE like.tweet_id = '${tweetId}';
    `;

    const likesResult = await db.all(likesQuery);

    response.send({ likes: likesResult.map((row) => row.username) });
  } else {
    // Invalid Request
    response.status(401);
    response.send("Invalid Request");
  }
});

// API 8: Get replies for a tweet
app.get(
  "/tweets/:tweetId/replies/",
  authenticate,
  async (request, response) => {
    const { username } = request.body;
    const { tweetId } = request.params;
    const userIdQuery = `SELECT user_id FROM user WHERE username = "${username}";`;
    const userIdResult = await db.get(userIdQuery);
    const userId = userIdResult.user_id;

    // Check if the user is following the author of the tweet
    const checkFollowingQuery = `
    SELECT *
    FROM tweet AS T
    JOIN follower AS F ON T.user_id = F.following_user_id
    WHERE T.tweet_id = '${tweetId}' AND F.follower_user_id = '${userId}';
  `;

    const isFollowing = await db.all(checkFollowingQuery);

    if (isFollowing.length > 0) {
      // User is following, fetch tweet and replies
      const tweetQuery = `
      SELECT T.tweet AS tweet
      FROM tweet AS T
      WHERE T.tweet_id = '${tweetId}';
    `;

      const repliesQuery = `
      SELECT user.name AS name, reply.reply AS reply
      FROM reply
      JOIN user ON reply.user_id = user.user_id
      WHERE reply.tweet_id = '${tweetId}';
    `;

      const tweetResult = await db.get(tweetQuery);
      const repliesResult = await db.all(repliesQuery);

      response.send({
        tweet: tweetResult.tweet,
        replies: repliesResult.map((eachReply) => eachReply.reply),
      });
    } else {
      // Invalid Request
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

const changeFormat = (eachResult) => {
  const finalResult = {
    tweet: eachResult.tweet,
    likes: eachResult.likes,
    replies: eachResult.replies,
    dateTime: eachResult.dateTime,
  };
  return finalResult;
};

// API 9: Get all tweets of the user
app.get("/user/tweets/", authenticate, async (request, response) => {
  const { username } = request.body;
  const userIdQuery = `SELECT user_id FROM user WHERE username = "${username}";`;
  const userIdResult = await db.get(userIdQuery);
  const userId = userIdResult.user_id;

  const selectQuery = `
    SELECT
      tweet.tweet AS tweet,
      COUNT(like.like_id) AS likes,
      COUNT(reply.reply_id) AS replies,
      tweet.date_time AS dateTime
    FROM
      tweet
      LEFT JOIN like ON tweet.tweet_id = like.tweet_id
      LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE
      tweet.user_id = '${userId}'
    GROUP BY
      tweet.tweet_id
    ORDER BY
      tweet.date_time DESC;
  `;

  const selectResult = await db.all(selectQuery);
  selectResult.map((eachResult) => changeFormat(eachResult));
  response.send(selectResult);
});

// API 10: Create a new tweet
app.post("/user/tweets/", authenticate, async (request, response) => {
  const { username } = request.body;
  const userIdQuery = `SELECT user_id FROM user WHERE username = "${username}";`;
  const userIdResult = await db.get(userIdQuery);
  const userId = userIdResult.user_id;

  const { tweet } = request.body;
  const date_time = new Date().toISOString();

  const insertQuery = `
    INSERT INTO tweet(user_id, tweet, date_time) VALUES
    ('${userId}', '${tweet}', '${date_time}');`;

  await db.run(insertQuery);
  response.send("Created a Tweet");
});

// API 11: Delete tweet by tweetId
app.delete("/tweets/:tweetId/", authenticate, async (request, response) => {
  const { username } = request.body;
  const { tweetId } = request.params;
  const userIdQuery = `SELECT user_id FROM user WHERE username = "${username}";`;
  const userIdResult = await db.get(userIdQuery);
  const userId = userIdResult.user_id;

  const deleteQuery = `
   DELETE FROM tweet
   WHERE tweet_id = '${tweetId}' AND user_id = '${userId}';`;

  const result = await db.run(deleteQuery);
  if (result.changes === 0) {
    response.status(401).send("Invalid Request");
  } else {
    response.send("Tweet Removed");
  }
});

module.exports = app;
