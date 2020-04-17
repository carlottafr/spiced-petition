const express = require("express");
const app = express();
const db = require("./db");
const hb = require("express-handlebars");
const cookieSession = require("cookie-session");
const csurf = require("csurf");
const { hash, compare } = require("./bc");

// Handlebars

app.engine("handlebars", hb());
app.set("view engine", "handlebars");

// Serve /public files

app.use(express.static("./public"));

// Request body parser

app.use(
    express.urlencoded({
        extended: false,
    })
);

// Cookie session

app.use(
    cookieSession({
        secret: `I'm always angry.`,
        // v cookie becomes invalid after 2 weeks
        maxAge: 1000 * 60 * 60 * 24 * 14,
    })
);

// CSURF middleware

app.use(csurf());

// Prevent my app to be loaded in a frame
// and implement the csurf middleware in
// this middleware

app.use((req, res, next) => {
    res.set("X-Frame-Options", "deny");
    // add csrfToken with Token value to empty res.locals object
    res.locals.csrfToken = req.csrfToken();
    next();
});

app.get("/", (req, res) => {
    // console.log("Session cookie when first created: ", req.session);
    // req.session.msg = "bigSecret99";
    // req.session.permission = true;
    // console.log("Session cookie after value is set: ", req.session);
    const { user } = req.session;
    if (user) {
        res.redirect("/petition");
    } else {
        res.redirect("/register");
    }
});

// GET /register

app.get("/register", (req, res) => {
    const { user } = req.session;
    if (user) {
        res.redirect("/petition");
    } else {
        res.render("register");
    }
});

// POST /register

app.post("/register", (req, res) => {
    let first = req.body.first;
    let last = req.body.last;
    let email = req.body.email;
    let password = req.body.pw;
    // check if all input fields have been filled
    if (first != "" && last != "" && email != "" && password != "") {
        hash(password)
            .then((hashedPw) => {
                return db.registerAccount(first, last, email, hashedPw);
            })
            .then((result) => {
                // set the user ID as a cookie
                console.log("This is the result: ", result.rows[0].id);
                req.session.user = {
                    firstName: first,
                    lastName: last,
                    userId: result.rows[0].id,
                };
                console.log(
                    `${req.session.user.firstName} ${req.session.user.lastName} has the ID: ${req.session.user.userId}`
                );
                res.redirect("/profile");
            })
            .catch((err) => {
                console.log("Error in registerAccount: ", err);
                res.render("register", { error: true });
            });
    } else if (
        // there is either an error or
        req.statusCode != 200 ||
        // the values are empty
        first == "" ||
        last == "" ||
        email == "" ||
        password == ""
    ) {
        // render the register template with error helper
        res.render("register", { error: true });
    }
});

// GET /profile

app.get("/profile", (req, res) => {
    const { user } = req.session;
    if (user) {
        res.render("profile");
    } else {
        res.redirect("/register");
    }
});

// POST /profile

app.post("/profile", (req, res) => {
    const age = req.body.age;
    const city = req.body.city;
    const url = req.body.homepage;
    const { user } = req.session;
    if (
        url != "" &&
        !url.startsWith("http://") &&
        !url.startsWith("https://")
    ) {
        res.render("profile", { badUrl: true });
    } else {
        db.addProfileInfo(age, city, url, user.userId)
            .then(() => {
                res.redirect("/petition");
            })
            .catch((err) => {
                console.log("Error in addProfileInfo: ", err);
                res.render("profile", { error: true });
            });
    }
});

// GET /login

app.get("/login", (req, res) => {
    const { user } = req.session;
    if (user) {
        res.redirect("/petition");
    } else {
        res.render("login");
    }
});

// POST /login

app.post("/login", (req, res) => {
    let first;
    let last;
    let email = req.body.email;
    let password = req.body.pw;
    let dbPw;
    let id;
    db.checkLogin(email)
        .then((result) => {
            console.log("The checkLogin result: ", result);
            first = result.rows[0].first;
            last = result.rows[0].last;
            dbPw = result.rows[0].password;
            id = result.rows[0].id;
            return dbPw;
        })
        .then((dbPw) => {
            return compare(password, dbPw);
        })
        .then((matchValue) => {
            if (matchValue) {
                req.session.user = {
                    firstName: first,
                    lastName: last,
                    userId: id,
                };
                return req.session.user.userId;
            } else if (!matchValue) {
                res.render("login", { error: true });
            }
        })
        .then((userId) => {
            db.checkSignature(userId).then((sigId) => {
                if (sigId.rows[0].id) {
                    req.session.user.sigId = sigId.rows[0].id;
                    res.redirect("/thanks");
                } else if (!sigId.rows[0].id) {
                    res.redirect("/petition");
                }
            });
        })
        .catch((err) => {
            console.log("Error in checkLogin: ", err);
            res.render("login", { error: true });
        });
});

// GET /petition

app.get("/petition", (req, res) => {
    // check for signature ID cookie
    const { user } = req.session;
    if (user.sigId) {
        res.redirect("/thanks");
    } else {
        res.render("petition");
    }
});

// POST /petition

app.post("/petition", (req, res) => {
    // parsed input values
    let signature = req.body.signature;
    const { user } = req.session;
    if (signature != "") {
        // insert the data as values in my signatures table
        db.signSupport(signature, user.userId)
            .then((result) => {
                // console.log("That worked, here is the ID: ", result.rows[0].id);
                // set ID cookie
                user.sigId = result.rows[0].id;
                console.log("This is the session cookie: ", user);
                res.redirect("/thanks");
            })
            .catch((err) => {
                console.log("Error in getSupport: ", err);
            });
    } else if (
        // there is either an error or
        req.statusCode != 200 ||
        // there is no signature
        signature == ""
    ) {
        // render the petition template with error helper
        res.render("petition", { error: true });
    }
});

// GET /thanks

app.get("/thanks", (req, res) => {
    // if a cookie is set, render with total number of supporters
    const { user } = req.session;
    let supportNumbers;
    if (user.sigId) {
        db.countSupports()
            .then((result) => {
                // console.log("Supporters have been counted: ", result);
                supportNumbers = result;
            })
            .catch((err) => {
                console.log("Error in countSupports: ", err);
            });
        db.getSignature(user.sigId)
            .then((result) => {
                res.render("thanks", {
                    first: user.firstName,
                    last: user.lastName,
                    signature: result,
                    number: supportNumbers,
                });
            })
            .catch((err) => {
                console.log("Error in getSignature: ", err);
            });
    } else {
        res.redirect("/petition");
    }
});

app.get("/profile/edit", (req, res) => {
    const { user } = req.session;
    db.displayInfo(user.userId).then((result) => {
        let profile = result.rows;
        console.log("This is the result of displayInfo: ", result.rows);
        res.render("edit", {
            first: profile[0].first,
            last: profile[0].last,
            email: profile[0].email,
            age: profile[0].age,
            city: profile[0].city,
            url: profile[0].url,
        });
    });
});

app.post("/thanks/delete", (req, res) => {
    const { user } = req.session;
    db.deleteSignature(user.userId)
        .then(() => {
            delete user.sigId;
            res.redirect("/petition");
        })
        .catch((err) => {
            console.log("Error in deleteSignature: ", err);
        });
});

// GET /signers

app.get("/signers", (req, res) => {
    // if a cookie is set, render
    const { user } = req.session;
    if (user) {
        db.getSupporters()
            .then((result) => {
                return result.rows;
            })
            .then((results) => {
                res.render("signers", { supporters: results });
            })
            .catch((err) => {
                console.log("Error in getSupporters: ", err);
            });
        // if not, redirect
    } else {
        res.redirect("/petition");
    }
});

// GET /signers/city

app.get("/signers/:city", (req, res) => {
    const { user } = req.session;
    // if a cookie is set, render
    if (user) {
        const city = req.params.city;
        db.supportersCity(city)
            .then((result) => {
                return result.rows;
            })
            .then((results) => {
                res.render("city", { place: city, citySupporters: results });
            })
            .catch((err) => {
                console.log("Error in supportersCity: ", err);
            });
    } else {
        res.redirect("/register");
    }
});

app.get("/logout", (req, res) => {
    req.session = null;
    res.redirect("/login");
});

app.listen(process.env.PORT || 8080, () =>
    console.log("Express server is at your service.")
);
