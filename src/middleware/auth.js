
function allowRoles(...allowedRoles) {
  return (req, res, next) => {
    // Demo authentication: role is supplied in request headers.
    const role = req.headers["x-user-role"];

    if (!role) {
      return res.status(401).json({
        error: "Please provide the x-user-role header"
      });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        error: "You do not have permission to perform this action"
      });
    }

    next();
  };
}

module.exports = { allowRoles };
