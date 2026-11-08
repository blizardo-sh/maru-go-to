import { writeFileSync } from 'node:fs';
import {loadCourse} from '../src/server/course';
import {defaultCatalog} from '../src/shared/catalog';
import {wordTargets} from '../src/shared/meanings';
import {confusableLearningWords} from '../src/shared/learningChoices';
const course=loadCourse({checkMedia:false}),words=wordTargets(course),choices:Record<string,string[]>={};
for(const route of course.learning??[]) for(const goal of route.goals)for(const part of goal.parts)for(const intro of part.words){
 if(defaultCatalog.quiz.choices[intro.wordId]||choices[intro.wordId])continue;
 const target=words.find(w=>w.id===intro.wordId)!;const selected=[target];
 const candidates=[...words.filter(w=>w.lessonIds.includes(route.lessonId)),...words].filter(w=>!w.trainingOnly&&w.reviewStatus!=='draft'&&w.kind===target.kind);
 for(const candidate of candidates){if(selected.some(w=>confusableLearningWords(w,candidate,defaultCatalog)))continue;selected.push(candidate);if(selected.length===4)break;}
 if(selected.length!==4)throw Error('No unambiguous distractors for '+intro.wordId);choices[intro.wordId]=selected.slice(1).map(w=>w.id);
}
writeFileSync('materials/books/quiz.json',JSON.stringify(choices,null,2)+'\n');console.log(Object.keys(choices).length,'new prepared choice groups');
