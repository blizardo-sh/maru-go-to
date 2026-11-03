import {loadCourse} from '../../src/server/course';

/** Keep pre-upgrade publication/outbox regressions under their original enrollment policy. */
export function legacyCourseFixture() {
 const course=loadCourse();delete course.catalog!.learningPolicy;
 for(const route of course.learning??[]) { route.version=route.version.replace(/-staged$/,'');for(const goal of route.goals)for(const part of goal.parts)if(part.counterPractice)delete part.counterPractice.formats; }
 return course;
}
