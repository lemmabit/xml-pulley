var gulp = require('gulp');
var babel = require('gulp-babel');

gulp.task('default', function() {
  return gulp.src('src/**/*.js')
  .pipe(babel({loose: 'all'}))
  .pipe(gulp.dest('lib'));
});