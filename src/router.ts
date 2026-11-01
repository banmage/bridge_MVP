import { createRouter, createWebHistory } from 'vue-router';
import LobbyView from './views/LobbyView.vue';
import RoomView from './views/RoomView.vue';
import SoloView from './views/SoloView.vue';
import MatchesView from './views/MatchesView.vue';

/** 路由：大厅 / 房间 / 单人 / 历史比赛 */
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'lobby', component: LobbyView },
    { path: '/room/:code', name: 'room', component: RoomView, props: true },
    { path: '/solo', name: 'solo', component: SoloView },
    { path: '/matches', name: 'matches', component: MatchesView },
    { path: '/matches/:id', name: 'match-detail', component: MatchesView, props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

export default router;
