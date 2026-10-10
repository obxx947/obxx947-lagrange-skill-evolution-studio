/* ========================================
   前端知识库检索引擎（纯JS）
   - 加载 data/knowledge/*.md
   - TF-IDF + 余弦相似度检索（中文bigram分词）
   - 简单LRU缓存 + 命中率统计
   ======================================== */

const KB = (function(){
    // 知识库文件清单（47个md，与「数据」文件夹同步）
    const FILE_LIST = [
    'A资料1.md',
    'A资料10.md',
    'A资料100.md',
    'A资料101.md',
    'A资料102.md',
    'A资料103.md',
    'A资料104.md',
    'A资料105.md',
    'A资料106.md',
    'A资料107.md',
    'A资料108.md',
    'A资料109.md',
    'A资料11.md',
    'A资料110.md',
    'A资料111.md',
    'A资料112.md',
    'A资料113.md',
    'A资料114.md',
    'A资料115.md',
    'A资料116.md',
    'A资料117.md',
    'A资料118.md',
    'A资料119.md',
    'A资料12.md',
    'A资料120.md',
    'A资料121.md',
    'A资料122.md',
    'A资料123.md',
    'A资料124.md',
    'A资料125.md',
    'A资料126.md',
    'A资料127.md',
    'A资料128.md',
    'A资料129.md',
    'A资料13.md',
    'A资料130.md',
    'A资料131.md',
    'A资料132.md',
    'A资料133.md',
    'A资料134.md',
    'A资料135.md',
    'A资料136.md',
    'A资料137.md',
    'A资料138.md',
    'A资料139.md',
    'A资料14.md',
    'A资料140.md',
    'A资料141.md',
    'A资料142.md',
    'A资料143.md',
    'A资料144.md',
    'A资料145.md',
    'A资料146.md',
    'A资料147.md',
    'A资料148.md',
    'A资料149.md',
    'A资料15.md',
    'A资料150.md',
    'A资料151.md',
    'A资料152.md',
    'A资料153.md',
    'A资料154.md',
    'A资料155.md',
    'A资料156.md',
    'A资料157.md',
    'A资料158.md',
    'A资料159.md',
    'A资料16.md',
    'A资料160.md',
    'A资料161.md',
    'A资料162.md',
    'A资料163.md',
    'A资料164.md',
    'A资料165.md',
    'A资料166.md',
    'A资料167.md',
    'A资料168.md',
    'A资料169.md',
    'A资料17.md',
    'A资料170.md',
    'A资料171.md',
    'A资料172.md',
    'A资料173.md',
    'A资料174.md',
    'A资料175.md',
    'A资料176.md',
    'A资料177.md',
    'A资料178.md',
    'A资料179.md',
    'A资料18.md',
    'A资料180.md',
    'A资料181.md',
    'A资料182.md',
    'A资料183.md',
    'A资料184.md',
    'A资料185.md',
    'A资料186.md',
    'A资料187.md',
    'A资料188.md',
    'A资料189.md',
    'A资料19.md',
    'A资料190.md',
    'A资料191.md',
    'A资料192.md',
    'A资料193.md',
    'A资料194.md',
    'A资料195.md',
    'A资料196.md',
    'A资料197.md',
    'A资料198.md',
    'A资料199.md',
    'A资料2.md',
    'A资料20.md',
    'A资料200.md',
    'A资料201.md',
    'A资料202.md',
    'A资料203.md',
    'A资料204.md',
    'A资料205.md',
    'A资料206.md',
    'A资料207.md',
    'A资料208.md',
    'A资料209.md',
    'A资料21.md',
    'A资料210.md',
    'A资料211.md',
    'A资料212.md',
    'A资料213.md',
    'A资料214.md',
    'A资料215.md',
    'A资料216.md',
    'A资料217.md',
    'A资料218.md',
    'A资料219.md',
    'A资料22.md',
    'A资料220.md',
    'A资料221.md',
    'A资料222.md',
    'A资料223.md',
    'A资料224.md',
    'A资料225.md',
    'A资料226.md',
    'A资料227.md',
    'A资料228.md',
    'A资料229.md',
    'A资料23.md',
    'A资料230.md',
    'A资料231.md',
    'A资料232.md',
    'A资料233.md',
    'A资料234.md',
    'A资料235.md',
    'A资料236.md',
    'A资料237.md',
    'A资料238.md',
    'A资料239.md',
    'A资料24.md',
    'A资料240.md',
    'A资料241.md',
    'A资料242.md',
    'A资料243.md',
    'A资料244.md',
    'A资料245.md',
    'A资料246.md',
    'A资料247.md',
    'A资料248.md',
    'A资料249.md',
    'A资料25.md',
    'A资料250.md',
    'A资料251.md',
    'A资料252.md',
    'A资料253.md',
    'A资料254.md',
    'A资料255.md',
    'A资料256.md',
    'A资料257.md',
    'A资料258.md',
    'A资料259.md',
    'A资料26.md',
    'A资料260.md',
    'A资料261.md',
    'A资料262.md',
    'A资料263.md',
    'A资料264.md',
    'A资料265.md',
    'A资料266.md',
    'A资料267.md',
    'A资料268.md',
    'A资料269.md',
    'A资料27.md',
    'A资料270.md',
    'A资料271.md',
    'A资料272.md',
    'A资料273.md',
    'A资料274.md',
    'A资料275.md',
    'A资料276.md',
    'A资料277.md',
    'A资料278.md',
    'A资料279.md',
    'A资料28.md',
    'A资料280.md',
    'A资料281.md',
    'A资料282.md',
    'A资料283.md',
    'A资料284.md',
    'A资料285.md',
    'A资料286.md',
    'A资料287.md',
    'A资料288.md',
    'A资料289.md',
    'A资料29.md',
    'A资料290.md',
    'A资料291.md',
    'A资料292.md',
    'A资料293.md',
    'A资料294.md',
    'A资料295.md',
    'A资料296.md',
    'A资料297.md',
    'A资料298.md',
    'A资料299.md',
    'A资料3.md',
    'A资料30.md',
    'A资料300.md',
    'A资料301.md',
    'A资料302.md',
    'A资料303.md',
    'A资料304.md',
    'A资料305.md',
    'A资料306.md',
    'A资料307.md',
    'A资料308.md',
    'A资料309.md',
    'A资料31.md',
    'A资料310.md',
    'A资料311.md',
    'A资料312.md',
    'A资料313.md',
    'A资料314.md',
    'A资料315.md',
    'A资料316.md',
    'A资料317.md',
    'A资料318.md',
    'A资料319.md',
    'A资料32.md',
    'A资料320.md',
    'A资料321.md',
    'A资料322.md',
    'A资料323.md',
    'A资料324.md',
    'A资料325.md',
    'A资料326.md',
    'A资料327.md',
    'A资料328.md',
    'A资料329.md',
    'A资料33.md',
    'A资料330.md',
    'A资料331.md',
    'A资料332.md',
    'A资料333.md',
    'A资料334.md',
    'A资料335.md',
    'A资料336.md',
    'A资料337.md',
    'A资料338.md',
    'A资料339.md',
    'A资料34.md',
    'A资料340.md',
    'A资料341.md',
    'A资料342.md',
    'A资料343.md',
    'A资料344.md',
    'A资料345.md',
    'A资料346.md',
    'A资料347.md',
    'A资料348.md',
    'A资料349.md',
    'A资料35.md',
    'A资料350.md',
    'A资料351.md',
    'A资料352.md',
    'A资料353.md',
    'A资料354.md',
    'A资料355.md',
    'A资料356.md',
    'A资料357.md',
    'A资料358.md',
    'A资料359.md',
    'A资料36.md',
    'A资料360.md',
    'A资料361.md',
    'A资料362.md',
    'A资料363.md',
    'A资料364.md',
    'A资料365.md',
    'A资料366.md',
    'A资料367.md',
    'A资料368.md',
    'A资料369.md',
    'A资料37.md',
    'A资料370.md',
    'A资料371.md',
    'A资料372.md',
    'A资料373.md',
    'A资料374.md',
    'A资料375.md',
    'A资料376.md',
    'A资料377.md',
    'A资料378.md',
    'A资料379.md',
    'A资料38.md',
    'A资料380.md',
    'A资料381.md',
    'A资料382.md',
    'A资料383.md',
    'A资料384.md',
    'A资料385.md',
    'A资料386.md',
    'A资料387.md',
    'A资料388.md',
    'A资料389.md',
    'A资料39.md',
    'A资料390.md',
    'A资料391.md',
    'A资料392.md',
    'A资料393.md',
    'A资料394.md',
    'A资料395.md',
    'A资料396.md',
    'A资料397.md',
    'A资料398.md',
    'A资料399.md',
    'A资料4.md',
    'A资料40.md',
    'A资料400.md',
    'A资料401.md',
    'A资料402.md',
    'A资料403.md',
    'A资料404.md',
    'A资料405.md',
    'A资料406.md',
    'A资料407.md',
    'A资料408.md',
    'A资料409.md',
    'A资料41.md',
    'A资料410.md',
    'A资料411.md',
    'A资料412.md',
    'A资料413.md',
    'A资料414.md',
    'A资料415.md',
    'A资料416.md',
    'A资料417.md',
    'A资料418.md',
    'A资料419.md',
    'A资料42.md',
    'A资料420.md',
    'A资料421.md',
    'A资料422.md',
    'A资料423.md',
    'A资料424.md',
    'A资料425.md',
    'A资料426.md',
    'A资料427.md',
    'A资料428.md',
    'A资料429.md',
    'A资料43.md',
    'A资料430.md',
    'A资料431.md',
    'A资料432.md',
    'A资料433.md',
    'A资料434.md',
    'A资料435.md',
    'A资料436.md',
    'A资料437.md',
    'A资料438.md',
    'A资料439.md',
    'A资料44.md',
    'A资料440.md',
    'A资料441.md',
    'A资料442.md',
    'A资料443.md',
    'A资料444.md',
    'A资料445.md',
    'A资料446.md',
    'A资料447.md',
    'A资料448.md',
    'A资料449.md',
    'A资料45.md',
    'A资料450.md',
    'A资料451.md',
    'A资料452.md',
    'A资料453.md',
    'A资料454.md',
    'A资料455.md',
    'A资料456.md',
    'A资料457.md',
    'A资料458.md',
    'A资料459.md',
    'A资料46.md',
    'A资料460.md',
    'A资料461.md',
    'A资料462.md',
    'A资料463.md',
    'A资料464.md',
    'A资料465.md',
    'A资料466.md',
    'A资料467.md',
    'A资料468.md',
    'A资料469.md',
    'A资料47.md',
    'A资料470.md',
    'A资料471.md',
    'A资料472.md',
    'A资料473.md',
    'A资料474.md',
    'A资料475.md',
    'A资料476.md',
    'A资料477.md',
    'A资料478.md',
    'A资料479.md',
    'A资料48.md',
    'A资料480.md',
    'A资料481.md',
    'A资料482.md',
    'A资料483.md',
    'A资料484.md',
    'A资料485.md',
    'A资料486.md',
    'A资料487.md',
    'A资料488.md',
    'A资料489.md',
    'A资料49.md',
    'A资料490.md',
    'A资料491.md',
    'A资料492.md',
    'A资料493.md',
    'A资料494.md',
    'A资料495.md',
    'A资料496.md',
    'A资料497.md',
    'A资料498.md',
    'A资料499.md',
    'A资料5.md',
    'A资料50.md',
    'A资料500.md',
    'A资料501.md',
    'A资料502.md',
    'A资料503.md',
    'A资料504.md',
    'A资料505.md',
    'A资料506.md',
    'A资料507.md',
    'A资料508.md',
    'A资料509.md',
    'A资料51.md',
    'A资料510.md',
    'A资料511.md',
    'A资料512.md',
    'A资料513.md',
    'A资料514.md',
    'A资料515.md',
    'A资料516.md',
    'A资料517.md',
    'A资料518.md',
    'A资料519.md',
    'A资料52.md',
    'A资料520.md',
    'A资料521.md',
    'A资料522.md',
    'A资料523.md',
    'A资料524.md',
    'A资料525.md',
    'A资料526.md',
    'A资料527.md',
    'A资料528.md',
    'A资料529.md',
    'A资料53.md',
    'A资料530.md',
    'A资料531.md',
    'A资料532.md',
    'A资料533.md',
    'A资料534.md',
    'A资料535.md',
    'A资料536.md',
    'A资料537.md',
    'A资料538.md',
    'A资料539.md',
    'A资料54.md',
    'A资料540.md',
    'A资料541.md',
    'A资料542.md',
    'A资料543.md',
    'A资料544.md',
    'A资料545.md',
    'A资料546.md',
    'A资料547.md',
    'A资料548.md',
    'A资料549.md',
    'A资料55.md',
    'A资料550.md',
    'A资料551.md',
    'A资料552.md',
    'A资料553.md',
    'A资料554.md',
    'A资料555.md',
    'A资料556.md',
    'A资料557.md',
    'A资料558.md',
    'A资料559.md',
    'A资料56.md',
    'A资料560.md',
    'A资料561.md',
    'A资料562.md',
    'A资料563.md',
    'A资料564.md',
    'A资料565.md',
    'A资料566.md',
    'A资料567.md',
    'A资料568.md',
    'A资料569.md',
    'A资料57.md',
    'A资料570.md',
    'A资料571.md',
    'A资料572.md',
    'A资料573.md',
    'A资料574.md',
    'A资料575.md',
    'A资料576.md',
    'A资料577.md',
    'A资料578.md',
    'A资料579.md',
    'A资料58.md',
    'A资料580.md',
    'A资料581.md',
    'A资料582.md',
    'A资料583.md',
    'A资料584.md',
    'A资料585.md',
    'A资料586.md',
    'A资料587.md',
    'A资料588.md',
    'A资料589.md',
    'A资料59.md',
    'A资料590.md',
    'A资料591.md',
    'A资料592.md',
    'A资料593.md',
    'A资料594.md',
    'A资料595.md',
    'A资料596.md',
    'A资料597.md',
    'A资料598.md',
    'A资料599.md',
    'A资料6.md',
    'A资料60.md',
    'A资料600.md',
    'A资料601.md',
    'A资料602.md',
    'A资料603.md',
    'A资料604.md',
    'A资料605.md',
    'A资料606.md',
    'A资料607.md',
    'A资料608.md',
    'A资料609.md',
    'A资料61.md',
    'A资料610.md',
    'A资料611.md',
    'A资料612.md',
    'A资料613.md',
    'A资料614.md',
    'A资料615.md',
    'A资料616.md',
    'A资料617.md',
    'A资料618.md',
    'A资料619.md',
    'A资料62.md',
    'A资料620.md',
    'A资料621.md',
    'A资料622.md',
    'A资料623.md',
    'A资料624.md',
    'A资料625.md',
    'A资料626.md',
    'A资料627.md',
    'A资料628.md',
    'A资料629.md',
    'A资料63.md',
    'A资料630.md',
    'A资料631.md',
    'A资料632.md',
    'A资料633.md',
    'A资料634.md',
    'A资料635.md',
    'A资料636.md',
    'A资料637.md',
    'A资料638.md',
    'A资料639.md',
    'A资料64.md',
    'A资料640.md',
    'A资料641.md',
    'A资料642.md',
    'A资料643.md',
    'A资料644.md',
    'A资料645.md',
    'A资料646.md',
    'A资料647.md',
    'A资料648.md',
    'A资料649.md',
    'A资料65.md',
    'A资料650.md',
    'A资料651.md',
    'A资料652.md',
    'A资料653.md',
    'A资料654.md',
    'A资料655.md',
    'A资料656.md',
    'A资料657.md',
    'A资料658.md',
    'A资料659.md',
    'A资料66.md',
    'A资料660.md',
    'A资料661.md',
    'A资料662.md',
    'A资料663.md',
    'A资料664.md',
    'A资料665.md',
    'A资料666.md',
    'A资料667.md',
    'A资料668.md',
    'A资料669.md',
    'A资料67.md',
    'A资料670.md',
    'A资料671.md',
    'A资料672.md',
    'A资料673.md',
    'A资料674.md',
    'A资料675.md',
    'A资料676.md',
    'A资料677.md',
    'A资料678.md',
    'A资料679.md',
    'A资料68.md',
    'A资料680.md',
    'A资料681.md',
    'A资料682.md',
    'A资料683.md',
    'A资料684.md',
    'A资料685.md',
    'A资料686.md',
    'A资料687.md',
    'A资料688.md',
    'A资料689.md',
    'A资料69.md',
    'A资料690.md',
    'A资料691.md',
    'A资料692.md',
    'A资料693.md',
    'A资料694.md',
    'A资料695.md',
    'A资料696.md',
    'A资料697.md',
    'A资料698.md',
    'A资料699.md',
    'A资料7.md',
    'A资料70.md',
    'A资料700.md',
    'A资料701.md',
    'A资料702.md',
    'A资料703.md',
    'A资料704.md',
    'A资料705.md',
    'A资料706.md',
    'A资料707.md',
    'A资料708.md',
    'A资料709.md',
    'A资料71.md',
    'A资料710.md',
    'A资料711.md',
    'A资料712.md',
    'A资料72.md',
    'A资料73.md',
    'A资料74.md',
    'A资料75.md',
    'A资料76.md',
    'A资料77.md',
    'A资料78.md',
    'A资料79.md',
    'A资料8.md',
    'A资料80.md',
    'A资料81.md',
    'A资料82.md',
    'A资料83.md',
    'A资料84.md',
    'A资料85.md',
    'A资料86.md',
    'A资料87.md',
    'A资料88.md',
    'A资料89.md',
    'A资料9.md',
    'A资料90.md',
    'A资料91.md',
    'A资料92.md',
    'A资料93.md',
    'A资料94.md',
    'A资料95.md',
    'A资料96.md',
    'A资料97.md',
    'A资料98.md',
    'A资料99.md',
    'B资料1-1.md',
    'B资料1-10.md',
    'B资料1-11.md',
    'B资料1-12.md',
    'B资料1-13.md',
    'B资料1-14.md',
    'B资料1-15.md',
    'B资料1-16.md',
    'B资料1-17.md',
    'B资料1-18.md',
    'B资料1-19.md',
    'B资料1-2.md',
    'B资料1-20.md',
    'B资料1-21.md',
    'B资料1-22.md',
    'B资料1-23.md',
    'B资料1-24.md',
    'B资料1-25.md',
    'B资料1-26.md',
    'B资料1-27.md',
    'B资料1-28.md',
    'B资料1-29.md',
    'B资料1-3.md',
    'B资料1-30.md',
    'B资料1-31.md',
    'B资料1-32.md',
    'B资料1-33.md',
    'B资料1-34.md',
    'B资料1-35.md',
    'B资料1-36.md',
    'B资料1-37.md',
    'B资料1-38.md',
    'B资料1-39.md',
    'B资料1-4.md',
    'B资料1-40.md',
    'B资料1-41.md',
    'B资料1-42.md',
    'B资料1-43.md',
    'B资料1-44.md',
    'B资料1-45.md',
    'B资料1-46.md',
    'B资料1-47.md',
    'B资料1-48.md',
    'B资料1-49.md',
    'B资料1-5.md',
    'B资料1-50.md',
    'B资料1-51.md',
    'B资料1-52.md',
    'B资料1-53.md',
    'B资料1-54.md',
    'B资料1-55.md',
    'B资料1-56.md',
    'B资料1-57.md',
    'B资料1-58.md',
    'B资料1-59.md',
    'B资料1-6.md',
    'B资料1-60.md',
    'B资料1-61.md',
    'B资料1-62.md',
    'B资料1-63.md',
    'B资料1-64.md',
    'B资料1-65.md',
    'B资料1-66.md',
    'B资料1-67.md',
    'B资料1-68.md',
    'B资料1-69.md',
    'B资料1-7.md',
    'B资料1-70.md',
    'B资料1-71.md',
    'B资料1-72.md',
    'B资料1-73.md',
    'B资料1-74.md',
    'B资料1-75.md',
    'B资料1-76.md',
    'B资料1-77.md',
    'B资料1-78.md',
    'B资料1-79.md',
    'B资料1-8.md',
    'B资料1-80.md',
    'B资料1-81.md',
    'B资料1-82.md',
    'B资料1-83.md',
    'B资料1-84.md',
    'B资料1-85.md',
    'B资料1-86.md',
    'B资料1-87.md',
    'B资料1-9.md',
    '实例1.md',
    '实例10.md',
    '实例100.md',
    '实例101.md',
    '实例102.md',
    '实例103.md',
    '实例104.md',
    '实例105.md',
    '实例106.md',
    '实例107.md',
    '实例108.md',
    '实例109.md',
    '实例11.md',
    '实例110.md',
    '实例111.md',
    '实例112.md',
    '实例113.md',
    '实例114.md',
    '实例115.md',
    '实例116.md',
    '实例117.md',
    '实例118.md',
    '实例119.md',
    '实例12.md',
    '实例120.md',
    '实例121.md',
    '实例122.md',
    '实例123.md',
    '实例124.md',
    '实例125.md',
    '实例126.md',
    '实例127.md',
    '实例128.md',
    '实例129.md',
    '实例13.md',
    '实例130.md',
    '实例131.md',
    '实例132.md',
    '实例133.md',
    '实例134.md',
    '实例135.md',
    '实例136.md',
    '实例137.md',
    '实例138.md',
    '实例139.md',
    '实例14.md',
    '实例140.md',
    '实例141.md',
    '实例142.md',
    '实例143.md',
    '实例144.md',
    '实例145.md',
    '实例146.md',
    '实例147.md',
    '实例148.md',
    '实例149.md',
    '实例15.md',
    '实例150.md',
    '实例151.md',
    '实例152.md',
    '实例153.md',
    '实例154.md',
    '实例155.md',
    '实例156.md',
    '实例157.md',
    '实例158.md',
    '实例159.md',
    '实例16.md',
    '实例160.md',
    '实例161.md',
    '实例162.md',
    '实例163.md',
    '实例164.md',
    '实例165.md',
    '实例166.md',
    '实例167.md',
    '实例168.md',
    '实例169.md',
    '实例17.md',
    '实例170.md',
    '实例171.md',
    '实例172.md',
    '实例173.md',
    '实例174.md',
    '实例175.md',
    '实例176.md',
    '实例177.md',
    '实例178.md',
    '实例179.md',
    '实例18.md',
    '实例180.md',
    '实例181.md',
    '实例182.md',
    '实例183.md',
    '实例184.md',
    '实例185.md',
    '实例186.md',
    '实例187.md',
    '实例188.md',
    '实例189.md',
    '实例19.md',
    '实例190.md',
    '实例191.md',
    '实例192.md',
    '实例193.md',
    '实例194.md',
    '实例195.md',
    '实例196.md',
    '实例197.md',
    '实例198.md',
    '实例199.md',
    '实例2.md',
    '实例20.md',
    '实例200.md',
    '实例201.md',
    '实例202.md',
    '实例203.md',
    '实例204.md',
    '实例205.md',
    '实例206.md',
    '实例207.md',
    '实例208.md',
    '实例209.md',
    '实例21.md',
    '实例210.md',
    '实例212.md',
    '实例213.md',
    '实例214.md',
    '实例215.md',
    '实例216.md',
    '实例217.md',
    '实例218.md',
    '实例219.md',
    '实例22.md',
    '实例220.md',
    '实例221.md',
    '实例222.md',
    '实例223.md',
    '实例224.md',
    '实例225.md',
    '实例23.md',
    '实例24.md',
    '实例25.md',
    '实例26.md',
    '实例29.md',
    '实例3.md',
    '实例30.md',
    '实例31.md',
    '实例32.md',
    '实例33.md',
    '实例34.md',
    '实例35.md',
    '实例36.md',
    '实例37.md',
    '实例38.md',
    '实例39.md',
    '实例4.md',
    '实例40.md',
    '实例41.md',
    '实例42.md',
    '实例43.md',
    '实例44.md',
    '实例45.md',
    '实例46.md',
    '实例47.md',
    '实例48.md',
    '实例49.md',
    '实例5.md',
    '实例50.md',
    '实例51.md',
    '实例52.md',
    '实例53.md',
    '实例54.md',
    '实例55.md',
    '实例56.md',
    '实例57.md',
    '实例58.md',
    '实例59.md',
    '实例6.md',
    '实例60.md',
    '实例61.md',
    '实例62.md',
    '实例63.md',
    '实例64.md',
    '实例65.md',
    '实例66.md',
    '实例67.md',
    '实例68.md',
    '实例69.md',
    '实例7.md',
    '实例70.md',
    '实例71.md',
    '实例72.md',
    '实例73.md',
    '实例74.md',
    '实例75.md',
    '实例76.md',
    '实例77.md',
    '实例78.md',
    '实例79.md',
    '实例8.md',
    '实例80.md',
    '实例81.md',
    '实例82.md',
    '实例83.md',
    '实例84.md',
    '实例85.md',
    '实例86.md',
    '实例87.md',
    '实例88.md',
    '实例89.md',
    '实例9.md',
    '实例90.md',
    '实例91.md',
    '实例92.md',
    '实例93.md',
    '实例94.md',
    '实例95.md',
    '实例96.md',
    '实例97.md',
    '实例98.md',
    '实例99.md',
    '战斗机制.md',
    '舰船人口.md',
    '舰船基础信息.md',
    '舰船资料1.md',
    '舰船资料10.md',
    '舰船资料100.md',
    '舰船资料101.md',
    '舰船资料102.md',
    '舰船资料103.md',
    '舰船资料104.md',
    '舰船资料105.md',
    '舰船资料106.md',
    '舰船资料107.md',
    '舰船资料108.md',
    '舰船资料109.md',
    '舰船资料11.md',
    '舰船资料110.md',
    '舰船资料111.md',
    '舰船资料112.md',
    '舰船资料113.md',
    '舰船资料114.md',
    '舰船资料115.md',
    '舰船资料116.md',
    '舰船资料117.md',
    '舰船资料118.md',
    '舰船资料119.md',
    '舰船资料12.md',
    '舰船资料120.md',
    '舰船资料121.md',
    '舰船资料122.md',
    '舰船资料123.md',
    '舰船资料124.md',
    '舰船资料125.md',
    '舰船资料126.md',
    '舰船资料127.md',
    '舰船资料128.md',
    '舰船资料129.md',
    '舰船资料13.md',
    '舰船资料130.md',
    '舰船资料131.md',
    '舰船资料132.md',
    '舰船资料133.md',
    '舰船资料134.md',
    '舰船资料135.md',
    '舰船资料136.md',
    '舰船资料137.md',
    '舰船资料138.md',
    '舰船资料139.md',
    '舰船资料14.md',
    '舰船资料140.md',
    '舰船资料141.md',
    '舰船资料142.md',
    '舰船资料143.md',
    '舰船资料144.md',
    '舰船资料145.md',
    '舰船资料146.md',
    '舰船资料147.md',
    '舰船资料148.md',
    '舰船资料149.md',
    '舰船资料15.md',
    '舰船资料150.md',
    '舰船资料151.md',
    '舰船资料152.md',
    '舰船资料153.md',
    '舰船资料154.md',
    '舰船资料155.md',
    '舰船资料156.md',
    '舰船资料157.md',
    '舰船资料158.md',
    '舰船资料159.md',
    '舰船资料16.md',
    '舰船资料160.md',
    '舰船资料161.md',
    '舰船资料162.md',
    '舰船资料163.md',
    '舰船资料164.md',
    '舰船资料165.md',
    '舰船资料166.md',
    '舰船资料167.md',
    '舰船资料168.md',
    '舰船资料169.md',
    '舰船资料17.md',
    '舰船资料170.md',
    '舰船资料171.md',
    '舰船资料172.md',
    '舰船资料173.md',
    '舰船资料174.md',
    '舰船资料175.md',
    '舰船资料176.md',
    '舰船资料177.md',
    '舰船资料178.md',
    '舰船资料179.md',
    '舰船资料18.md',
    '舰船资料180.md',
    '舰船资料181.md',
    '舰船资料182.md',
    '舰船资料183.md',
    '舰船资料184.md',
    '舰船资料185.md',
    '舰船资料186.md',
    '舰船资料187.md',
    '舰船资料19.md',
    '舰船资料2.md',
    '舰船资料20.md',
    '舰船资料21.md',
    '舰船资料22.md',
    '舰船资料23.md',
    '舰船资料24.md',
    '舰船资料25.md',
    '舰船资料26.md',
    '舰船资料27.md',
    '舰船资料28.md',
    '舰船资料29.md',
    '舰船资料3.md',
    '舰船资料30.md',
    '舰船资料31.md',
    '舰船资料32.md',
    '舰船资料33.md',
    '舰船资料34.md',
    '舰船资料35.md',
    '舰船资料36.md',
    '舰船资料37.md',
    '舰船资料38.md',
    '舰船资料39.md',
    '舰船资料4.md',
    '舰船资料40.md',
    '舰船资料41.md',
    '舰船资料42.md',
    '舰船资料43.md',
    '舰船资料44.md',
    '舰船资料45.md',
    '舰船资料46.md',
    '舰船资料47.md',
    '舰船资料48.md',
    '舰船资料49.md',
    '舰船资料5.md',
    '舰船资料50.md',
    '舰船资料51.md',
    '舰船资料52.md',
    '舰船资料53.md',
    '舰船资料54.md',
    '舰船资料55.md',
    '舰船资料56.md',
    '舰船资料57.md',
    '舰船资料58.md',
    '舰船资料59.md',
    '舰船资料6.md',
    '舰船资料60.md',
    '舰船资料61.md',
    '舰船资料62.md',
    '舰船资料63.md',
    '舰船资料64.md',
    '舰船资料65.md',
    '舰船资料66.md',
    '舰船资料67.md',
    '舰船资料68.md',
    '舰船资料69.md',
    '舰船资料7.md',
    '舰船资料70.md',
    '舰船资料71.md',
    '舰船资料72.md',
    '舰船资料73.md',
    '舰船资料74.md',
    '舰船资料75.md',
    '舰船资料76.md',
    '舰船资料77.md',
    '舰船资料78.md',
    '舰船资料79.md',
    '舰船资料8.md',
    '舰船资料80.md',
    '舰船资料81.md',
    '舰船资料82.md',
    '舰船资料83.md',
    '舰船资料84.md',
    '舰船资料85.md',
    '舰船资料86.md',
    '舰船资料87.md',
    '舰船资料88.md',
    '舰船资料89.md',
    '舰船资料9.md',
    '舰船资料90.md',
    '舰船资料91.md',
    '舰船资料92.md',
    '舰船资料93.md',
    '舰船资料94.md',
    '舰船资料95.md',
    '舰船资料96.md',
    '舰船资料97.md',
    '舰船资料98.md',
    '舰船资料99.md',
    '黑话.md',
];   /* 2026-10-06 重建主库后重新生成（1212 个） */

    // 第二知识库文件清单（51个，来自知识库备份：旧舰船资料/讲解/精炼数据；第一知识库检索不清晰时来此找）
    const BACKUP_FILES = [];   /* 同上 */

    let chunks = [];        // [{content, source}]
    let idf = null;         // {term: idf}
    let docVectors = null;  // [{term: tfidf}]
    let loaded = false;
    let loading = null;

    // 缓存
    const cache = new Map();
    let hits = 0, misses = 0;
    let redline = new Set();   // 数据文件夹红线白名单：仅允许知识库(data/knowledge + corpus)内 source 进入检索结果

    // ======== 分词：中文bigram + 英文单词 ========
    function tokenize(text){
        const tokens = {};
        const t = String(text||'').toLowerCase();
        // 中文bigram
        for(let i=0;i<t.length-1;i++){
            const c1=t.charCodeAt(i), c2=t.charCodeAt(i+1);
            if(c1>0x2e80 && c2>0x2e80){
                const bi=t.substring(i,i+2);
                tokens[bi]=(tokens[bi]||0)+1;
            }
        }
        // 英文/数字词
        const words=t.match(/[a-z0-9]+/g)||[];
        words.forEach(w=>{ if(w.length>1) tokens[w]=(tokens[w]||0)+1; });
        return tokens;
    }

    // ======== 加载知识库 ========
    async function load(){
        if(loaded) return true;
        if(loading) return loading;
        loading = (async()=>{
            try{
                // 优先加载新语料（已拆分的 1050+ 块，一次性取回），避免逐文件 fetch
                try{
                    const cr = await fetch((window.KB_BASE||'')+'data/kb_corpus.json',{cache:'no-cache'});
                    if(cr.ok){
                        const cd = await cr.json();
                        const cs = (cd.chunks||[]);
                        if(cs.length){
                            chunks = cs.map((c,i)=>({content:c.content, source:c.source, chunkIndex:(c.chunkIndex!=null?c.chunkIndex:i), idx:i}));
                            loaded = true; buildIndex(); return true;
                        }
                    }
                }catch(e){}
                const base = (window.KB_BASE||'')+'data/knowledge/';
                const all = await Promise.all(FILE_LIST.map(async f=>{
                    try{
                        const r = await fetch(base+encodeURI(f),{cache:'no-cache'});
                        if(!r.ok) return null;
                        const text = await r.text();
                        // 分块：500字符/块
                        const blocks=[];
                        for(let i=0;i<text.length;i+=500){
                            blocks.push(text.substring(i,i+500));
                        }
                        return blocks.map((b,bi)=>({content:b,source:f,chunkIndex:bi,idx:0}));
                    }catch(e){ return null; }
                }));
                // 第二知识库（备份资料）：第一知识库检索不清晰时使用，source 带 backup/ 前缀
                const base2 = (window.KB_BASE||'')+'data/knowledge_backup/';
                const all2 = await Promise.all(BACKUP_FILES.map(async f=>{
                    try{
                        const r = await fetch(base2+encodeURI(f),{cache:'no-cache'});
                        if(!r.ok) return null;
                        const text = await r.text();
                        const blocks=[];
                        for(let i=0;i<text.length;i+=500){
                            blocks.push(text.substring(i,i+500));
                        }
                        return blocks.map((b,bi)=>({content:b,source:'backup/'+f,chunkIndex:bi,idx:0}));
                    }catch(e){ return null; }
                }));
                chunks = [...all.filter(Boolean).flat(), ...all2.filter(Boolean).flat()].map((c,i)=>({...c, idx:i}));
                loaded = true;
                buildIndex();
                return true;
            }catch(e){
                console.error('KB load failed:', e);
                return false;
            }
        })();
        return loading;
    }

    // ======== 构建TF-IDF索引 ========
    function buildIndex(){
        const df = {};
        docVectors = chunks.map(c=>{
            const tf = tokenize(c.content);
            Object.keys(tf).forEach(term=>{ df[term]=(df[term]||0)+1; });
            return tf;
        });
        idf = {};
        const N = chunks.length;
        Object.keys(df).forEach(term=>{
            idf[term] = Math.log(N/(df[term]+1))+1;
        });
        // 数据文件夹红线白名单：以当前知识库 source 为准
        redline = new Set(chunks.map(c=>String(c.source||'')));
    }

    // ======== 查询向量 ========
    function queryVec(query){
        const tf = tokenize(query);
        const vec = {};
        Object.keys(tf).forEach(term=>{
            if(idf[term]) vec[term] = tf[term]*idf[term];
        });
        return vec;
    }

    function cosSim(v1,v2){
        let dot=0,n1=0,n2=0;
        for(const k in v1){ dot += v1[k]*(v2[k]||0); n1 += v1[k]*v1[k]; }
        for(const k in v2){ n2 += v2[k]*v2[k]; }
        if(!n1||!n2) return 0;
        return dot/Math.sqrt(n1*n2);
    }

    // ======== 检索（带缓存） ========
    function search(query, topK=5){
        const cacheKey = query;
        if(cache.has(cacheKey)){
            hits++;
            return cache.get(cacheKey);
        }
        misses++;
        const qv = queryVec(query);
        const scored = chunks.map((c,i)=>{
            return {content:c.content, source:c.source, chunkIndex:c.chunkIndex, idx:c.idx, score:cosSim(qv,docVectors[i]), _tfidf:cosSim(qv,docVectors[i])};
        }).sort((a,b)=>b.score-a.score).slice(0,topK);
        // 缓存结果
        cache.set(cacheKey, scored);
        if(cache.size>200) cache.delete(cache.keys().next().value);
        return scored;
    }

    // ======== 按分类检索（子代理） ========
    function searchByCategory(query, keywords, topK=3){
        const qv = queryVec(query);
        const scored = chunks.map((c,i)=>{
            let kwBonus=0;
            const src=c.source;
            if(keywords.some(k=>src.includes(k))) kwBonus+=0.3;
            return {content:c.content, source:c.source, chunkIndex:c.chunkIndex, idx:c.idx, score:cosSim(qv,docVectors[i])+kwBonus, _tfidf:cosSim(qv,docVectors[i])};
        }).sort((a,b)=>b.score-a.score).slice(0,topK);
        return scored;
    }

    function hitRate(){
        const total=hits+misses;
        return {hits, misses, total, rate: total?Math.round(hits/total*1000)/10:0};
    }

    // ======== 元数据分层加权（音频口语稿降权 / 结构化舰船·配队数据升权） ========
    // source 分类：音频稿(backup/例子*.txt/资料*.txt)、舰船资料、战斗机制、实例配队
    function metadataWeight(source, baseScore){
        let w = 1.0;
        // 结构化高价值资料 → 升权
        if(/舰船数据|舰船资料|舰船人口|舰船基础|黑话/.test(source)) w = 1.25;
        if(/实例|例子|数据\d/.test(source)) w = 1.15;
        if(/战斗机制/.test(source)) w = 1.1;
        // 音频口语转写稿 → 降权（噪声高）
        if(/backup\/例子|backup\/data|资料\d+\.txt/.test(source)) w = 0.85;
        return baseScore * w;
    }

    // ======== 片段语义过滤（口语稿降噪：短碎片/语气词过密） ========
    function isNoiseChunk(content){
        const s = String(content||'');
        if(s.length < 8) return true;  // 太短
        // 语气词/口头语占比过高（连续口语堆砌）
        const filler=(s.match(/嗯|啊|就是|然后|那个|这个|我们|你们|的话|呢|吧|哈/g)||[]).length;
        if(filler>0 && filler/s.length > 0.08) return true;
        return false;
    }

    // ======== RRF 倒数排名融合（双路结果 → 融合分数） ========
    // listA/listB: [{...result, idx}]，k=60 标准
    function rrfFuse(listA, listB, k=60){
        const scores = {};
        const add = (list, weight)=>{
            (list||[]).forEach((item, rank)=>{
                const key = item.idx!=null?item.idx:(item.source+'#'+item.chunkIndex);
                scores[key] = (scores[key]||0) + weight/(k+rank+1);
                if(!scores[key+'_item']) scores[key+'_item']=item;
            });
        };
        add(listA, 1.0);
        add(listB, 1.0);
        return Object.keys(scores).filter(kx=>!kx.endsWith('_item'))
            .map(kx=>({...scores[kx+'_item'], rrscore:scores[kx]}))
            .sort((a,b)=>b.rrscore-a.rrscore);
    }

    // ======== 相邻块上下文扩展（补同 source 前后 chunk） ========
    function contextExpand(topResults, extend=1){
        const out = [];
        const seen = new Set();
        for(const r of topResults){
            if(seen.has(r.source+'#'+r.chunkIndex)) continue;
            out.push(r); seen.add(r.source+'#'+r.chunkIndex);
            // 同 source 前/后块
            for(let d=1; d<=extend; d++){
                const prev = chunks.find(c=>c.source===r.source && c.chunkIndex===r.chunkIndex-d);
                if(prev){ out.push({content:prev.content, source:prev.source, chunkIndex:prev.chunkIndex, idx:prev.idx, score:r.score*0.7, _expand:true}); seen.add(prev.source+'#'+prev.chunkIndex); }
                const nxt = chunks.find(c=>c.source===r.source && c.chunkIndex===r.chunkIndex+d);
                if(nxt){ out.push({content:nxt.content, source:nxt.source, chunkIndex:nxt.chunkIndex, idx:nxt.idx, score:r.score*0.7, _expand:true}); seen.add(nxt.source+'#'+nxt.chunkIndex); }
            }
        }
        return out;
    }

    // ======== 数据文件夹 md 红线：检索结果仅允许来自知识库内的 source ========
    // 防止外部/注入的外部来源片段污染知识库；未加载知识库时放行(哨兵)
    function isRedlineSource(source){
        if(!redline.size) return true;
        return redline.has(String(source||''));
    }

    // ======== 质量门控（召回块整体低分 → 触发改写二次检索标记） ========
    function qualityGate(results, threshold=0.1){
        if(!results.length) return {pass:false, reason:'无召回'};
        const avg = results.reduce((s,r)=>s+(r.score||0),0)/results.length;
        return {pass: avg>=threshold, reason: avg>=threshold?'ok':'召回质量低(avg='+avg.toFixed(3)+')', avg};
    }

    // ======== 混合检索主入口（向量+语义，懒计算） ========
    // query: 用户问题; opts: {topK, category}
    async function hybridSearch(query, opts){
        const topK = (opts&&opts.topK)||5;
        const category = opts && opts.category;
        const kws = opts && opts.kws;
        // 1. 关键词召回候选（top-20 供语义再算）
        let sparse = category&&kws ? searchByCategory(query, kws, 20) : search(query, 20);
        // 移除噪声碎片
        sparse = sparse.filter(c=>!isNoiseChunk(c.content));
        // 元数据加权
        sparse = sparse.map(c=>({...c, _wscore: metadataWeight(c.source, c._tfidf!=null?c._tfidf:c.score)}));
        // 2. 语义召回：优先静态向量库(RAG)；未就绪则回退 KbEmbed。skipEmbed(默认Flash)时跳过语义，直接用稀疏
        let dense = [];
        const cand = sparse.map(c=>({content:c.content, source:c.source, chunkIndex:c.chunkIndex, idx:c.idx}));
        if(window.RAG && !(opts&&opts.skipEmbed)){
            try{
                if(!RAG.ready()) await RAG.load();
                if(RAG.ready()){
                    const sem = await RAG.semanticRetrieve(query, cand);
                    dense = sem.map(s=>({...s, _sem:s.score}));
                }
            }catch(e){ dense = []; }
        }
        if(!dense.length && window.KbEmbed && !(opts&&opts.skipEmbed)){
            try{
                const sem = await window.KbEmbed.semanticRetrieve(query, cand);
                dense = sem.map(s=>({...s, _sem:s.score}));
            }catch(e){ dense = []; }
        }
        // 3. 混合：若语义成功 → 两路融合；失败(无key/网络) → 只用稀疏
        let fused;
        if(dense.length){
            // 语义分转 [0,1]待用, 与稀疏融合
            const sparseTop = sparse.filter(c=>c._wscore!=null).map(c=>({...c, score:c._wscore}));
            const denseTop = dense.map(c=>({...c, score:c._sem}));
            fused = rrfFuse(sparseTop, denseTop);
        }else{
            fused = sparse.map(c=>({...c, score:c._wscore||c.score}));
        }
        // 4. 相邻块扩展
        const expanded = contextExpand(fused.slice(0, topK));
        // 5. 质量门控：低分 → 触发一次改写二次检索(CRAG)，提升召回
        let gate = qualityGate(expanded);
        if(!gate.pass && (opts&&opts.recheck)!==false){
            const q2 = String(query||'').trim() + ' 舰船数据 配队 实例 战斗机制';
            try{
                const retry = await hybridSearch(q2, {...opts, topK, recheck:false});
                if(retry && retry.results && retry.results.length){
                    const map = new Map();
                    [...expanded, ...retry.results].forEach(r=>{
                        const k = r.source+'#'+r.chunkIndex;
                        if(!map.has(k) || (map.get(k).score||0) < (r.score||0)) map.set(k, r);
                    });
                    const merged = [...map.values()];
                    gate = qualityGate(merged);
                    gate.rechecked = true;
                    return {results: merged.filter(r=>isRedlineSource(r.source)).slice(0, topK+extendGuard()),
                            gate, sparseCount:sparse.length, denseCount:dense.length, rechecked:true};
                }
            }catch(e){}
        }
        return {results: expanded.filter(r=>isRedlineSource(r.source)).slice(0, topK+extendGuard()), gate, sparseCount:sparse.length, denseCount:dense.length};
    }
    function extendGuard(){ return 2; }

    return {load, search, searchByCategory, hitRate, tokenize,
            metadataWeight, rrfFuse, contextExpand, qualityGate, isNoiseChunk, hybridSearch,
            isRedlineSource, getFiles: () => FILE_LIST.slice(), get chunks(){return chunks;}};
})();

// ======== 舰船数据库 ========
const SHIP_DB = (function(){
    let ships = [];
    let loaded = false;
    let loading = null;
    async function load(){
        if(loaded) return true;
        if(loading) return loading;
        loading = (async()=>{
            try{
                const r = await fetch((window.KB_BASE||'')+'data/ship_database.json',{cache:'no-cache'});
                if(!r.ok) return false;
                const data = await r.json();
                ships = Array.isArray(data)?data:(Object.values(data)||[]);
                loaded = true;
                return true;
            }catch(e){ return false; }
        })();
        return loading;
    }
    function search(name){
        if(!name) return [];
        const n = String(name).toLowerCase();
        return ships.filter(s=>{
            return String(s.name||'').toLowerCase().includes(n) || String(s.id||'').toLowerCase().includes(n);
        }).map(s=>({
            id:s.id, name:s.name, type:s.type, hp:s.hp,
            physicalArmor:s.physicalArmor, energyArmor:s.energyArmor,
            position:s.position, commandValue:s.commandValue,
            serviceLimit:s.serviceLimit, size:s.size,
            ratings:s.ratings, speed:s.speed, modules:s.modules
        }));
    }
    // 按 id/name 返回原始完整舰船对象（含 serviceLimit/size/modules.variants 等），供用户舰船库对齐属性
    function get(id){
        if(!id) return null;
        const n=String(id).toLowerCase();
        return ships.find(s=>String(s.id||'').toLowerCase()===n || String(s.name||'').toLowerCase()===n)||null;
    }
    // 返回全部舰船（列表展示/配队用）
    function all(){
        return ships.map(s=>({id:s.id, name:s.name, type:s.type, modules:s.modules, commandValue:s.commandValue, serviceLimit:s.serviceLimit, position:s.position, hp:s.hp, aircraftSlots:s.aircraftSlots, isCarrier:s.isCarrier, airSlots:s.airSlots, airSize:s.airSize}));
    }
    return {load, search, get, all};
})();

// 显式暴露到window（跨script标签访问）
window.KB = KB;
window.SHIP_DB = SHIP_DB;
