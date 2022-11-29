import { configureStore } from '@reduxjs/toolkit';
import { Dispatch } from 'redux';
import createSagaMiddleware from 'redux-saga';
import { GraphActions, graphReducer } from '../features/graph/graph-reducer';
import { saga } from './saga';

const sagaMiddleware = createSagaMiddleware();
export const store = configureStore({
  reducer: {
    graph: graphReducer,
  },
  middleware: [sagaMiddleware]
});

sagaMiddleware.run(saga);

export type AppDispatch = Dispatch<GraphActions>;
export type RootState = ReturnType<typeof store.getState>;
