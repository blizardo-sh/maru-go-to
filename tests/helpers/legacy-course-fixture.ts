import {loadCourse} from '../../src/server/course';

/** Keep pre-upgrade publication/outbox regressions under their original enrollment policy. */
export function legacyCourseFixture() {
 const course=loadCourse();delete course.catalog!.learningPolicy;delete course.catalog!.wordCards;
 for(const route of course.learning??[]) { route.version=route.version.replace(/-staged$/,'').replace('-visual-v1','');for(const goal of route.goals)for(const part of goal.parts){for(const word of part.words)delete word.visualCards;if(part.counterPractice)delete part.counterPractice.formats;} }
 return course;
}
