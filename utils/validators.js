const AppError = require("./appError");
const Joi = require("joi");

exports.isPasswordValid = (password) => {
  const uppercaseRegex = /[A-Z]/;
  const symbolRegex = /[!@#$%^&*()_+{}[\]:;<>,.?~\\-]/;
  const letterRegex = /[a-zA-Z]/;
  const numberRegex = /[0-9]/;

  return (
    uppercaseRegex.test(password) &&
    symbolRegex.test(password) &&
    letterRegex.test(password) &&
    numberRegex.test(password)
  );
};

exports.forgotPasswordValidator = function (req, _res, next) {
  const schema = Joi.object({
    email: Joi.string().email().required(),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return next(new AppError(error.message, 400));
  }
  next();
};

exports.resetPasswordValidator = function (req, _res, next) {
  const schema = Joi.object({
    password: Joi.string()
      .pattern(
        new RegExp(
          "^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])(?=.{8,})"
        )
      )
      .message(
        "Password must contain at least eight characters. It must have at least one upper case, one lower case, one number and one special character."
      )
      .required(),

    confirmPassword: Joi.ref("password"),
  }).with("password", "confirmPassword");

  const { error } = schema.validate(req.body);
  if (error) {
    return next(new AppError(error.message, 400));
  }
  next();
};