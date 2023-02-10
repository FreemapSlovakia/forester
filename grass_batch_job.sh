v.in.ogr min_area=0.0001 snap=-1.0 input="work/out8353.shp" output="aaa" --overwrite -o
v.generalize input=aaa type="line,boundary,area" method="chaiken" threshold=1 look_ahead=7 reduction=50 slide=0.5 angle_thresh=3 degree_thresh=0 closeness_thresh=0 betweeness_thresh=0 alpha=1 beta=1 iterations=1 -l output=bbb --overwrite
v.generalize input=bbb type="line,boundary,area" method="douglas" threshold=0.5 look_ahead=7 reduction=50 slide=0.5 angle_thresh=3 degree_thresh=0 closeness_thresh=0 betweeness_thresh=0 alpha=1 beta=1 iterations=1 -l output=ccc --overwrite
v.out.ogr type="auto" input="ccc" output="work/generalized.gpkg" format="GPKG" --overwrite
