import { parseProject, parseStage, type Project, type Stage } from "../lib/workshop-parse.ts";
import exchange from "../../projects/exchange/project.md";
import exchange01 from "../../projects/exchange/stages/01/stage.md";
import exchange02 from "../../projects/exchange/stages/02/stage.md";
import exchange03 from "../../projects/exchange/stages/03/stage.md";
import exchange04 from "../../projects/exchange/stages/04/stage.md";
import exchange05 from "../../projects/exchange/stages/05/stage.md";
import exchange06 from "../../projects/exchange/stages/06/stage.md";
import exchange07 from "../../projects/exchange/stages/07/stage.md";
import exchange08 from "../../projects/exchange/stages/08/stage.md";
import exchange09 from "../../projects/exchange/stages/09/stage.md";
import exchange10 from "../../projects/exchange/stages/10/stage.md";

/*
 * Большие проекты, на которых строится обучение. Этап готов, когда у него есть stage.md (и тесты, и эталон);
 * остальные этапы из дорожной карты project.md показываются как «впереди».
 * Новый этап: папка projects/<id>/stages/NN + строка здесь + `node server/devpath/verify.ts <id>` из корня хаба (нужен Docker).
 */

export interface BuildProject extends Project {
  stages: Stage[];
}

export const BUILD_PROJECTS: BuildProject[] = [
  { ...parseProject("exchange", exchange), stages: [
    parseStage(1, exchange01), parseStage(2, exchange02), parseStage(3, exchange03), parseStage(4, exchange04), parseStage(5, exchange05), parseStage(6, exchange06),
    parseStage(7, exchange07), parseStage(8, exchange08), parseStage(9, exchange09), parseStage(10, exchange10),
  ] },
];

export const buildProjectById = (id: string) => BUILD_PROJECTS.find((p) => p.id === id);
